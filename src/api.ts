import { BigNumber, Signer } from 'ethers';
import express, { Request, Response } from 'express';
import { hasExpectedBalance } from './queuelistener';
import { formatEther } from 'ethers/lib/utils';
import { redisClient } from './redisclient';
import { APPLICATION_ID, CONSUMER_ID, MAX_NON_ACK_PENDING_MESSAGES, PROCESSOR_ALERT_TIMESTAMP_STUCK_DURATION, PROCESSOR_QUEUE_LISTENER_LOOP_MAX_TIMEOUT, REDIS_KEY_TS_LAST_MESSAGE, STREAM_KEY } from './constants';
import { logger } from './logger';


export async function initializeApi(processorSigner: Signer, processorAlertBalance: BigNumber) {
    const port = process.env.PORT || 3000;
    const app = express();
    const monitorRedisClient = redisClient.duplicate();
    monitorRedisClient.connect();

    app.get('/api/monitor/liveness', async (req: Request, res: Response) => {
        const status = {
            processor: "ok",
            nonAckPendingTx: "ok",
        }
        let statusCode = 200;
        
        const nonAckMessages = await getNonAckMessages(monitorRedisClient);
        if (nonAckMessages > MAX_NON_ACK_PENDING_MESSAGES) {
            status.nonAckPendingTx = "error - " + nonAckMessages + " non-ack messages";
            statusCode = 500;
        }

        const lastCheckTimestamp = await getLastCheckTimestamp(monitorRedisClient);
        logger.debug(lastCheckTimestamp);
        if(new Date().getTime() - lastCheckTimestamp.getTime() > PROCESSOR_QUEUE_LISTENER_LOOP_MAX_TIMEOUT) {
            status.processor = "error - last successful queue processing " + lastCheckTimestamp.toISOString();
            statusCode = 500;
        }

        if (statusCode === 200) {
            logger.debug("liveness monitor ok");
        } else {
            logger.error("liveness monitor error - 500 " + JSON.stringify(status));
        }
        res.status(statusCode).send(status);
    });

    app.get('/api/monitor/readiness', async (req: Request, res: Response) => {
        const status = {
            balance: "ok",
            pendingMessageIsStuck: "ok",
        }
        let statusCode = 200;
        
        const balancesT = await hasExpectedBalance(processorSigner, processorAlertBalance);
        if (!balancesT.hasBalance) {
            status.balance = "error - processor balance is " + formatEther(balancesT.balance) + " ETH";
            statusCode = 500;
        }

        const timestampOfLastMessgeInRedis = await getTimestampOfLastMessageInRedis(monitorRedisClient);
        if(timestampOfLastMessgeInRedis > -1 && new Date().getTime() - timestampOfLastMessgeInRedis > PROCESSOR_ALERT_TIMESTAMP_STUCK_DURATION) {
            status.pendingMessageIsStuck = "error - stuck message in redis. message timestamp " + new Date(timestampOfLastMessgeInRedis).toISOString();
            statusCode = 500;
        }
        
        if (statusCode === 200) {
            logger.debug("readiness monitor ok");
        } else {
            logger.error("readiness monitor error - 500 " + JSON.stringify(status));
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

async function getTimestampOfLastMessageInRedis(monitorRedisClient: any) {
    const timestamp = await monitorRedisClient.get(REDIS_KEY_TS_LAST_MESSAGE);
    if (timestamp === null) {
        return -1;
    }

    return parseInt(timestamp);
}