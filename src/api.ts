import { BigNumber, Signer } from 'ethers';
import express, { Request, Response } from 'express';
import { hasExpectedBalance } from './queuelistener';
import { formatEther } from 'ethers/lib/utils';
import { redisClient } from './redisclient';
import { APPLICATION_ID, CONSUMER_ID, MAX_NON_ACK_PENDING_MESSAGES, PROCESSOR_QUEUE_LISTENER_LOOP_MAX_TIMEOUT, STREAM_KEY } from './constants';
import { logger } from './logger';


export async function initializeApi(processorSigner: Signer, processorExpectedBalance: BigNumber) {
    const port = process.env.PORT || 3000;
    const app = express();
    const monitorRedisClient = redisClient.duplicate();
    monitorRedisClient.connect();

    app.get('/api/monitor', async (req: Request, res: Response) => {
        const status = {
            balance: "ok",
            processor: "ok",
            nonAckPendingTx: "ok",
        }
        let statusCode = 200;

        const balancesT = await hasExpectedBalance(processorSigner, processorExpectedBalance);
        if (!balancesT.hasBalance) {
            status.balance = "error - " + formatEther(balancesT.balance) + " ETH";
            statusCode = 500;
        }

        const nonAckMessages = await getNonAckMessages(monitorRedisClient);
        if (nonAckMessages > MAX_NON_ACK_PENDING_MESSAGES) {
            status.nonAckPendingTx = "error - " + nonAckMessages + " non-ack messages";
            statusCode = 500;
        }

        const lastCheckTimestamp = await getLastCheckTimestamp(monitorRedisClient);
        if(new Date().getTime() - lastCheckTimestamp.getTime() > PROCESSOR_QUEUE_LISTENER_LOOP_MAX_TIMEOUT) {
            status.processor = "error - last successful queue processing " + lastCheckTimestamp.toISOString();
            statusCode = 500;
        }
        
        if (statusCode === 200) {
            logger.debug("monitor ok");
        } else {
            logger.error("monitor error - 500 " + JSON.stringify(status));
        }
        res.status(statusCode).send(status);
    });

    app.listen(port, () => {
        logger.info(`⚡️[server]: Server is running at https://localhost:${port}`);
    });
}

async function getNonAckMessages(monitorRedisClient: any) {
    const r = await monitorRedisClient.xReadGroup(
        APPLICATION_ID,
        CONSUMER_ID,
        { key: STREAM_KEY, id: '0' },
        { COUNT: 10, BLOCK: 10 }
    );

    if (r === null) {
        return 0;
    }

    return Math.max(r.length, r[0].messages.length);
}

async function getLastCheckTimestamp(monitorRedisClient: any) {
    const lastCheck = await monitorRedisClient.get("last-check");
    if (lastCheck === null) {
        return new Date(0);
    }

    return new Date(lastCheck);
}

