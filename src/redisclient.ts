import { createClient } from 'redis';
import { logger } from './logger';
import { REDIS_URL } from './constants';

export const redisClient = createClient({ url: REDIS_URL || 'redis://redis:6379' });
redisClient.on('error', err => logger.error('Redis Client Error', err));
redisClient.connect();

