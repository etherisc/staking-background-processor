import { BigNumber, Signer } from 'ethers';
import { formatBytes32String, formatEther, formatUnits } from 'ethers/lib/utils';
import { EntityId, Repository } from 'redis-om';
import { APPLICATION_ID, BALANCE_TOO_LOW_TIMEOUT, CHAIN_MINUMUM_REQUIRED_CONFIRMATIONS, CONSUMER_ID, ERROR_TIMEOUT, REDIS_READ_BLOCK_TIMEOUT, STREAM_KEY } from './constants';
import { logger } from './logger';
import { redisClient } from './redisclient';
import { IStaking, IStaking__factory } from './contracts/registry-contracts';
import { getPendingRestakeRepository } from './pending_restake';
import { getPendingStakeRepository } from './pending_stake';

export default class QueueListener {

    async listen(depegProductAddress: string, processorSigner: Signer, maxFeePerGas: BigNumber, processorExpectedBalance: BigNumber): Promise<void> {
        try {
            await redisClient.xGroupCreate(STREAM_KEY, APPLICATION_ID, "0", { MKSTREAM: true });
        } catch (err) {
            logger.info("group already exists");
        }

        const staking = IStaking__factory.connect(depegProductAddress, processorSigner);
        
        // initialize last-check with current timestamp
        await redisClient.set("last-check", new Date().toISOString());
        logger.info("attaching to queue " + STREAM_KEY + " with group " + APPLICATION_ID + " and consumer " + CONSUMER_ID);

        while(true) {
            const balanceState = await hasExpectedBalance(processorSigner, processorExpectedBalance);
            if (! balanceState.hasBalance) {
                logger.error('processor balance too low, waiting ' + BALANCE_TOO_LOW_TIMEOUT + 'ms. balance: ' + formatEther(balanceState.balance) + ' ETH');
                await new Promise(f => setTimeout(f, BALANCE_TOO_LOW_TIMEOUT));
                continue;
            }

            try {
                const pendingMessage = await this.getNextPendingMessage();
                if (pendingMessage !== null) {
                    await this.processMessage(pendingMessage.id, pendingMessage.message, staking, maxFeePerGas);
                    // repeat this while there are pending messages
                    continue;
                }
                
                const newMessage = await this.getNextNewMessage();
                if (newMessage !== null) {
                    await this.processMessage(newMessage.id, newMessage.message, staking, maxFeePerGas);
                }
            } catch (e) {
                logger.error('caught error, blocking for ' + ERROR_TIMEOUT + 'ms', e);
                await new Promise((resolve) => setTimeout(resolve, ERROR_TIMEOUT));
            }

            await this.clearMinedEntities(await getPendingStakeRepository(), processorSigner);
            await this.clearMinedEntities(await getPendingRestakeRepository(), processorSigner);
            // update last-check timestamp
            await redisClient.set("last-check", new Date().toISOString());
        }
    }

    async getNextPendingMessage(): Promise<{ id: string, message: any } | null> {
        logger.debug("checking for pending messages");
        const r = await redisClient.xReadGroup(
            APPLICATION_ID,
            CONSUMER_ID,
            { key: STREAM_KEY, id: '0' },
            { COUNT: 1, BLOCK: 10 }
        );

        if (r === null || r?.length === 0 || r[0].messages.length === 0) {
            return null;
        }
        
        const obj = r[0].messages[0];
        return { id: obj.id, message: obj.message };
    }

    async getNextNewMessage(): Promise<{ id: string, message: any } | null> {
        logger.debug("checking for new messages");
        const r = await redisClient.xReadGroup(
            APPLICATION_ID,
            CONSUMER_ID,
            { key: STREAM_KEY, id: '>' },
            { COUNT: 1, BLOCK: REDIS_READ_BLOCK_TIMEOUT }
        );

        if (r === null || r?.length === 0) {
            return null;
        }
        
        const obj = r[0].messages[0];
        return { id: obj.id, message: obj.message };
    }

    async processMessage(id: string, message: any, staking: IStaking, maxFeePerGas: BigNumber) {
        const signatureId = message.signatureId as string;
        const type = message.type as string;
        logger.info("processing message id: " + id + " signatureId " + message.signatureId + " type " + message.type);
        
        if (type === 'stake') {
            await this.processStakeMessage(id, signatureId, staking, maxFeePerGas);
        } else if (type === 'restake') {
            await this.processRestakeMessage(id, signatureId, staking, maxFeePerGas);
        } else {
            logger.error("invalid type " + type + " ignoring");
            await redisClient.xAck(STREAM_KEY, APPLICATION_ID, id);
            return;
        }
    }

    async processStakeMessage(id: string, signatureId: string, staking: IStaking, maxFeePerGas: BigNumber) {
        const pendingStakeRepo = await getPendingStakeRepository();
        const pendingStakeEntity = await pendingStakeRepo.search().where("signatureId").eq(signatureId).return.first();

        if (pendingStakeEntity == null) {
            logger.error("no pending stake found for signatureId " + signatureId + ", ignoring");
            await redisClient.xAck(STREAM_KEY, APPLICATION_ID, id);
            return;
        }

        try {
            const owner = pendingStakeEntity.owner as string;
            const targetNftId = BigNumber.from(pendingStakeEntity.targetNftId as string);
            const dipAmount = BigNumber.from(pendingStakeEntity.dipAmount as string);
            const signatureIdB32s = formatBytes32String(signatureId)
            const signature = pendingStakeEntity.signature as string;
            logger.info("TX staking - "
                + "owner: " + owner
                + " targetNftId: " + formatUnits(targetNftId, 0)
                + " dipAmount: " + formatEther(dipAmount)
                + " signatureId: " + signatureIdB32s
                + " signature: " + signature);
            const tx = await staking.createStakeWithSignature(
                owner,
                targetNftId, 
                dipAmount,
                signatureIdB32s,
                signature,
                {
                    maxFeePerGas,
                }
            );
            logger.info("tx: " + tx.hash);
        
            pendingStakeEntity.transactionHash = tx.hash;
            await pendingStakeRepo.save(pendingStakeEntity);
            logger.info("updated PendingStake (" + signatureId + ") with tx hash " + tx.hash);
            await redisClient.xAck(STREAM_KEY, APPLICATION_ID, id);
            logger.debug("acked redis message " + id);
        } catch (e) {
            // @ts-ignore
            if (e.error?.error?.error?.data?.reason !== undefined) {
                // @ts-ignore
                const reason = e.error.error.error.data.reason;
                logger.error("stake failed. reason: " + reason);
                const entityId = pendingStakeEntity[EntityId] as string;
                await pendingStakeRepo.remove(entityId);
                logger.debug("removed pending stake " + entityId);
                return;
            }            
            throw e;
        }
    }

    async processRestakeMessage(id: string, signatureId: string, staking: IStaking, maxFeePerGas: BigNumber) {
        const pendingRestakeRepo = await getPendingRestakeRepository();
        const pendingRestakeEntity = await pendingRestakeRepo.search().where("signatureId").eq(signatureId).return.first();

        if (pendingRestakeEntity == null) {
            logger.error("no pending restake found for signatureId " + signatureId + ", ignoring");
            await redisClient.xAck(STREAM_KEY, APPLICATION_ID, id);
            return;
        }

        try {
            const owner = pendingRestakeEntity.owner as string;
            const stakeNftId = BigNumber.from(pendingRestakeEntity.stakeNftId as string);
            const targetNftId = BigNumber.from(pendingRestakeEntity.targetNftId as string);
            const signatureIdB32s = formatBytes32String(signatureId)
            const signature = pendingRestakeEntity.signature as string;
            
            logger.info("TX restaking - "
                + "owner: " + owner
                + " stakeNftId: " + formatUnits(stakeNftId, 0)
                + " targetNftId: " + formatUnits(targetNftId, 0)
                + " signatureId: " + signatureIdB32s
                + " signature: " + signature);

            const tx = await staking.restakeWithSignature(
                owner,
                stakeNftId,
                targetNftId,
                signatureIdB32s,
                signature,
                {
                    maxFeePerGas,
                }
            );
            logger.info("tx: " + tx.hash);
        
            pendingRestakeEntity.transactionHash = tx.hash;
            await pendingRestakeRepo.save(pendingRestakeEntity);
            logger.info("updated PendingRestake (" + signatureId + ") with tx hash " + tx.hash);
            await redisClient.xAck(STREAM_KEY, APPLICATION_ID, id);
            logger.debug("acked redis message " + id);
        } catch (e) {
            // @ts-ignore
            if (e.error?.error?.error?.data?.reason !== undefined) {
                // @ts-ignore
                const reason = e.error.error.error.data.reason;
                logger.error("restake failed. reason: " + reason);
                const entityId = pendingRestakeEntity[EntityId] as string;
                await pendingRestakeRepo.remove(entityId);
                logger.debug("removed pending restake " + entityId);
                return;
            }  
            throw e;
        }
    }


    async clearMinedEntities(pendingTxRepo: Repository, signer: Signer) {
        logger.debug("checking state of mined repo transactions");
        const pendingTransactions = await pendingTxRepo.search().return.all();
        for (const pendingTransaction of pendingTransactions) {
            if (pendingTransaction.transactionHash === undefined) {
                continue;
            }
            const rcpt = await signer.provider!.getTransaction(pendingTransaction.transactionHash as string);
            const wasMined = rcpt.blockHash !== null && rcpt.confirmations > CHAIN_MINUMUM_REQUIRED_CONFIRMATIONS;
            logger.debug(`mined: ${wasMined}`);
            if (wasMined) {
                logger.info("transaction " + pendingTransaction.transactionHash + " has been mined. removing pending (re)stake with signatureId " + pendingTransaction.signatureId);
                await pendingTxRepo.remove(pendingTransaction[EntityId] as string);
            }
        }
    }

}

export async function hasExpectedBalance(processorSigner: Signer, processorExpectedBalance: BigNumber): Promise<{ hasBalance: boolean, balance: BigNumber} > {
    const balance = await processorSigner.getBalance();
    const has = (balance).gte(processorExpectedBalance);
    return { hasBalance: has, balance };
}
