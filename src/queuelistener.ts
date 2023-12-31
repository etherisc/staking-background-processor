import { BigNumber, Signer } from 'ethers';
import { formatBytes32String, formatEther, formatUnits, parseUnits } from 'ethers/lib/utils';
import { EntityId, Repository } from 'redis-om';
import { APPLICATION_ID, BALANCE_TOO_LOW_TIMEOUT, CHAIN_MINUMUM_REQUIRED_CONFIRMATIONS, CONSUMER_ID, ERROR_TIMEOUT, REDIS_KEY_TS_LAST_MESSAGE, REDIS_READ_BLOCK_TIMEOUT, STREAM_KEY } from './constants';
import { logger } from './logger';
import { redisClient } from './redisclient';
import { IStaking, IStaking__factory } from './contracts/registry-contracts';
import { getPendingRestakeRepository } from './pending_restake';
import { getPendingStakeRepository } from './pending_stake';

export default class QueueListener {

    async listen(depegProductAddress: string, processorSigner: Signer, maxFeePerGas: BigNumber, maxPriorityFeePerGas: BigNumber | undefined, processorMinBalance: BigNumber): Promise<void> {
        try {
            await redisClient.xGroupCreate(STREAM_KEY, APPLICATION_ID, "0", { MKSTREAM: true });
        } catch (err) {
            logger.info("group already exists");
        }

        const staking = IStaking__factory.connect(depegProductAddress, processorSigner);
        
        // initialize last-check with current timestamp
        await redisClient.set("last-check", new Date().toISOString());
        await redisClient.set(REDIS_KEY_TS_LAST_MESSAGE, -1);
        logger.info("attaching to queue " + STREAM_KEY + " with group " + APPLICATION_ID + " and consumer " + CONSUMER_ID);

        while(true) {
            // always clean up first
            await this.clearMinedEntities(await getPendingStakeRepository(), processorSigner);
            await this.clearMinedEntities(await getPendingRestakeRepository(), processorSigner);

            const balanceState = await hasExpectedBalance(processorSigner, processorMinBalance);
            if (! balanceState.hasBalance) {
                logger.error('processor balance too low, waiting ' + BALANCE_TOO_LOW_TIMEOUT + 'ms. balance: ' + formatEther(balanceState.balance) + ' ETH');
                await new Promise(f => setTimeout(f, BALANCE_TOO_LOW_TIMEOUT));
                continue;
            }

            try {
                const pendingMessage = await this.getNextPendingMessage();
                if (pendingMessage !== null) {
                    await this.processMessage(pendingMessage.id, pendingMessage.message, staking, maxFeePerGas, maxPriorityFeePerGas);
                    // repeat this while there are pending messages
                    continue;
                }
                
                const newMessage = await this.getNextNewMessage();
                if (newMessage !== null) {
                    await this.processMessage(newMessage.id, newMessage.message, staking, maxFeePerGas, maxPriorityFeePerGas);
                }
            } catch (e) {
                logger.error('caught error, blocking for ' + ERROR_TIMEOUT + 'ms', e);
                await new Promise((resolve) => setTimeout(resolve, ERROR_TIMEOUT));
            } finally {
                // update last-check timestamp
                await redisClient.set("last-check", new Date().toISOString());
            }
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

    async processMessage(redisId: string, message: any, staking: IStaking, maxFeePerGas: BigNumber, maxPriorityFeePerGas: BigNumber | undefined) {
        const entityId = message.entityId as string;
        const type = message.type as string;
        logger.info("processing message id: " + redisId + " entityId " + entityId + " type " + type);
        
        if (type === 'stake') {
            await this.processStakeMessage(redisId, entityId, staking, maxFeePerGas, maxPriorityFeePerGas);
        } else if (type === 'restake') {
            await this.processRestakeMessage(redisId, entityId, staking, maxFeePerGas, maxPriorityFeePerGas);
        } else {
            logger.error("invalid type " + type + " ignoring");
            await redisClient.xAck(STREAM_KEY, APPLICATION_ID, redisId);
            return;
        }
    }

    async processStakeMessage(redisId: string, entityId: string, staking: IStaking, maxFeePerGas: BigNumber, maxPriorityFeePerGas: BigNumber | undefined) {
        const pendingStakeRepo = await getPendingStakeRepository();
        const pendingStakeEntity = await pendingStakeRepo.fetch(entityId);

        if (pendingStakeEntity == null) {
            logger.error("no pending stake found for entityId " + entityId + ", ignoring");
            await redisClient.xAck(STREAM_KEY, APPLICATION_ID, redisId);
            return;
        }

        try {
            const owner = pendingStakeEntity.owner as string;
            const targetNftId = BigNumber.from(pendingStakeEntity.targetNftId as string);
            const dipAmount = BigNumber.from(pendingStakeEntity.dipAmount as string);
            const signatureIdB32s = formatBytes32String(pendingStakeEntity.signatureId as string)
            const signature = pendingStakeEntity.signature as string;
            await redisClient.set(REDIS_KEY_TS_LAST_MESSAGE, (pendingStakeEntity.timestamp as Date).getTime());

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
                    maxPriorityFeePerGas,
                }
            );

            logger.info("awaiting tx: " + tx.hash);
            
            const receipt = await tx.wait();
            const success = receipt.status === 1;

            if (success) {
                logger.info("tx: " + tx.hash + " - success");
            } else {
                logger.error("tx: " + tx.hash + " - reverted");
            }

            pendingStakeEntity.transactionHash = tx.hash;
            await pendingStakeRepo.save(pendingStakeEntity);
            logger.info("updated PendingStake (" + entityId + ") with tx hash " + tx.hash);
            await this.ackRedisMessage(redisId);
        } catch (e) {
            await this.handleError(e, pendingStakeRepo, entityId, redisId);
        }
    }

    async processRestakeMessage(redisId: string, entityId: string, staking: IStaking, maxFeePerGas: BigNumber, maxPriorityFeePerGas: BigNumber | undefined) {
        const pendingRestakeRepo = await getPendingRestakeRepository();
        const pendingRestakeEntity = await pendingRestakeRepo.fetch(entityId);

        if (pendingRestakeEntity == null) {
            logger.error("no pending restake found for entityId " + entityId + ", ignoring");
            await redisClient.xAck(STREAM_KEY, APPLICATION_ID, redisId);
            return;
        }

        try {
            const owner = pendingRestakeEntity.owner as string;
            const stakeNftId = BigNumber.from(pendingRestakeEntity.stakeNftId as string);
            const targetNftId = BigNumber.from(pendingRestakeEntity.targetNftId as string);
            const signatureIdB32s = formatBytes32String(pendingRestakeEntity.signatureId as string)
            const signature = pendingRestakeEntity.signature as string;
            await redisClient.set(REDIS_KEY_TS_LAST_MESSAGE, (pendingRestakeEntity.timestamp as Date).getTime());
            
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
                    maxPriorityFeePerGas,
                }
            );

            logger.info("awaiting tx: " + tx.hash);
            
            const receipt = await tx.wait();
            const success = receipt.status === 1;

            if (success) {
                logger.info("tx: " + tx.hash + " - success");
            } else {
                logger.error("tx: " + tx.hash + " - reverted");
            }
            
            pendingRestakeEntity.transactionHash = tx.hash;
            await pendingRestakeRepo.save(pendingRestakeEntity);
            logger.info("updated PendingRestake (" + entityId + ") with tx hash " + tx.hash);
            await this.ackRedisMessage(redisId);
        } catch (e) {
            await this.handleError(e, pendingRestakeRepo, entityId, redisId);
        }
    }
    
    async handleError(e: unknown, repo: Repository, entityId: string, redisId: string ) {
        // @ts-ignore
        if (e.error?.reason !== undefined) {
            // @ts-ignore
            const reason = e.error.reason as string;
            if (reason.includes("ERROR:SMH-001:SIGNATURE_USED")) {
                logger.error("tx failed. reason: ERROR:SMH-001:SIGNATURE_USED ... ignoring");
                await this.dropMessageFromRepoAndRedis(repo, entityId, redisId);
                return;
            } else if (reason.includes("ECDSA: invalid signature")) {
                logger.error("tx failed. reason: ECDSA: invalid signature ... ignoring");
                await this.dropMessageFromRepoAndRedis(repo, entityId, redisId);
                return;
            } else if (reason.includes("ERROR:STK-290:DIP_BALANCE_INSUFFICIENT")) {
                logger.error("tx failed. reason: ERROR:STK-290:DIP_BALANCE_INSUFFICIENT ... ignoring");
                await this.dropMessageFromRepoAndRedis(repo, entityId, redisId);
                return;
            } else if (reason.includes("ERROR:STK-291:DIP_ALLOWANCE_INSUFFICIENT")) {
                logger.error("tx failed. reason: ERROR:STK-291:DIP_ALLOWANCE_INSUFFICIENT ... ignoring");
                await this.dropMessageFromRepoAndRedis(repo, entityId, redisId);
                return;
            } else if (reason.includes("ERROR:STK-292:DIP_TRANSFER_FROM_FAILED")) {
                logger.error("tx failed. reason: ERROR:STK-292:DIP_TRANSFER_FROM_FAILED ... ignoring");
                await this.dropMessageFromRepoAndRedis(repo, entityId, redisId);
                return;
            } else {
                logger.error("tx failed. reason: " + reason);
            }
        // @ts-ignore 
        } else if (e.error?.error?.error?.data?.reason !== undefined) {
            // @ts-ignore
            const reason = e.error.error.error.data.reason;
            logger.error("tx failed. reason: " + reason);
            await this.dropMessageFromRepoAndRedis(repo, entityId, redisId);
            return;
        } 
        throw e;
    }

    async dropMessageFromRepoAndRedis(repo: Repository, entityId: string, redisId: string) {
        await repo.remove(entityId);
        logger.debug("removed pending (re)stake " + entityId);
        await this.ackRedisMessage(redisId);
    }

    async ackRedisMessage(redisId: string) {
        await redisClient.xAck(STREAM_KEY, APPLICATION_ID, redisId);
        logger.debug("acked redis message " + redisId);
        await redisClient.set(REDIS_KEY_TS_LAST_MESSAGE, -1);
    }


    async clearMinedEntities(pendingTxRepo: Repository, signer: Signer) {
        logger.debug("checking state of mined repo transactions");
        const pendingTransactions = await pendingTxRepo.search().return.all();
        for (const pendingTransaction of pendingTransactions) {
            if (pendingTransaction.transactionHash === undefined) {
                continue;
            }
            const rcpt = await signer.provider!.getTransaction(pendingTransaction.transactionHash as string);
            const wasMined = rcpt !== null && rcpt.blockHash !== null && rcpt.confirmations > CHAIN_MINUMUM_REQUIRED_CONFIRMATIONS;
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
