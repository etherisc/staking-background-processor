import { BigNumber, Signer } from 'ethers';
import { formatBytes32String, formatEther } from 'ethers/lib/utils';
import { EntityId, Repository } from 'redis-om';
import { APPLICATION_ID, BALANCE_TOO_LOW_TIMEOUT, CHAIN_MINUMUM_REQUIRED_CONFIRMATIONS, CONSUMER_ID, ERROR_TIMEOUT, REDIS_READ_BLOCK_TIMEOUT, STREAM_KEY } from './constants';
import { DepegProduct, DepegProduct__factory } from "./contracts/depeg-contracts";
import { logger } from './logger';
import { getPendingApplicationRepository } from './pending_application';
import { redisClient } from './redisclient';

export default class QueueListener {

    async listen(depegProductAddress: string, processorSigner: Signer, maxFeePerGas: BigNumber, processorExpectedBalance: BigNumber): Promise<void> {
        try {
            await redisClient.xGroupCreate(STREAM_KEY, APPLICATION_ID, "0", { MKSTREAM: true });
        } catch (err) {
            logger.info("group already exists");
        }

        const product = DepegProduct__factory.connect(depegProductAddress, processorSigner);
        const pendingTransactionRepository = await getPendingApplicationRepository();
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
                    await this.processMessage(pendingMessage.id, pendingMessage.message, product, pendingTransactionRepository, maxFeePerGas);
                    // repeat this while there are pending messages
                    continue;
                }
                
                const newMessage = await this.getNextNewMessage();
                if (newMessage !== null) {
                    await this.processMessage(newMessage.id, newMessage.message, product, pendingTransactionRepository, maxFeePerGas);
                }
            } catch (e) {
                logger.error('caught error, blocking for ' + ERROR_TIMEOUT + 'ms', e);
                await new Promise(f => setTimeout(f, ERROR_TIMEOUT));
            }

            await this.checkPendingTransactions(pendingTransactionRepository, processorSigner);
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

    async processMessage(id: string, message: any, product: DepegProduct, pendingTransactionRepository: Repository, maxFeePerGas: BigNumber) {
        logger.info("processing id: " + id + " signatureId " + message.signatureId);
        const signatureId = message.signatureId as string;
        
        logger.info("application - signatureId: " + signatureId);

        const pendingApplicationEntity = await pendingTransactionRepository.search().where("signatureId").eq(signatureId).return.first();

        if (pendingApplicationEntity == null) {
            logger.error("no pending application found for signatureId " + signatureId + ", ignoring");
            await redisClient.xAck(STREAM_KEY, APPLICATION_ID, id);
            return;
        }

        try {
            const tx = await product.applyForPolicyWithBundleAndSignature(
                pendingApplicationEntity.policyHolder as string,
                pendingApplicationEntity.protectedWallet as string,
                pendingApplicationEntity.protectedBalance as string,
                pendingApplicationEntity.duration as number,
                pendingApplicationEntity.bundleId as number,
                formatBytes32String(signatureId),
                pendingApplicationEntity.signature as string,
                {
                    maxFeePerGas,
                }
            );
            logger.info("tx: " + tx.hash);
        
            pendingApplicationEntity.transactionHash = tx.hash;
            await pendingTransactionRepository.save(pendingApplicationEntity);
            logger.info("updated PendingApplication (" + signatureId + ") with tx hash " + tx.hash);
            await redisClient.xAck(STREAM_KEY, APPLICATION_ID, id);
            logger.debug("acked redis message " + id);
        } catch (e) {
            // @ts-ignore
            if (e.error?.error?.error?.data?.reason !== undefined) {
                // @ts-ignore
                const reason = e.error.error.error.data.reason;
                logger.error("application failed. reason: " + reason);
                const entityId = pendingApplicationEntity[EntityId] as string;
                await pendingTransactionRepository.remove(entityId);
                logger.debug("removed pending application " + entityId);
                return;
            }            
            throw e;
        }
    }

    async checkPendingTransactions(pendingTransactionRepository: Repository, signer: Signer) {
        logger.debug("checking state of pending transactions");
        const pendingTransactions = await pendingTransactionRepository.search().return.all();
        for (const pendingTransaction of pendingTransactions) {
            if (pendingTransaction.transactionHash === null) {
                continue;
            }
            const rcpt = await signer.provider!.getTransaction(pendingTransaction.transactionHash as string);
            const wasMined = rcpt.blockHash !== null && rcpt.confirmations > CHAIN_MINUMUM_REQUIRED_CONFIRMATIONS;
            logger.debug(`mined: ${wasMined}`);
            if (wasMined) {
                logger.info("transaction " + pendingTransaction.transactionHash + " has been mined. removing pending application, signatureId " + pendingTransaction.signatureId);
                await pendingTransactionRepository.remove(pendingTransaction[EntityId] as string);
            }
        }
    }

}

export async function hasExpectedBalance(processorSigner: Signer, processorExpectedBalance: BigNumber): Promise<{ hasBalance: boolean, balance: BigNumber} > {
    const balance = await processorSigner.getBalance();
    const has = (balance).gte(processorExpectedBalance);
    return { hasBalance: has, balance };
}
