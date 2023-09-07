import { BigNumber } from "ethers";
import { parseEther } from "ethers/lib/utils";
import * as dotenv from 'dotenv';

dotenv.config();

export const APPLICATION_ID = process.env.REDIS_QUEUE_APPLICATION_ID ?? "staking-backend-processor";
export const CONSUMER_ID = process.env.REDIS_QUEUE_CONSUMER_ID ?? "staking-backend-processor-consumer";
export const STREAM_KEY = process.env.REDIS_QUEUE_STREAM_KEY ?? "feeless:signatures";

export const STAKING_ADDRESS = process.env.STAKING_ADDRESS ?? "";
export const PROCESSOR_MNEMONIC = process.env.PROCESSOR_MNEMONIC ?? "";
export const MAX_FEE_PER_GAS = BigNumber.from(process.env.MAX_FEE_PER_GAS || 30000000000);
export const MAX_PRIORITY_FEE_PER_GAS = process.env.MAX_PRIORITY_FEE_PER_GAS ? BigNumber.from(process.env.MAX_PRIORITY_FEE_PER_GAS) : undefined;
// if the process balance is lower than this value, the processor will stop processing the queue
export const PROCESSOR_MIN_BALANCE = process.env.PROCESSOR_MIN_BALANCE ? BigNumber.from(process.env.PROCESSOR_MIN_BALANCE) : parseEther("1.0");
// if the process balance is lower than this value, the processor will send an alert
export const PROCESSOR_ALERT_BALANCE = process.env.PROCESSOR_ALERT_BALANCE ? BigNumber.from(process.env.PROCESSOR_ALERT_BALANCE) : parseEther("1.0");
export const CHAIN_RPC_URL = process.env.CHAIN_RPC_URL ?? "";
export const CHAIN_MINUMUM_REQUIRED_CONFIRMATIONS = process.env.CHAIN_MINUMUM_REQUIRED_CONFIRMATIONS ? parseInt(process.env.CHAIN_MINUMUM_REQUIRED_CONFIRMATIONS) : 6;
export const MAX_NON_ACK_PENDING_MESSAGES = process.env.MAX_NON_ACK_PENDING_MESSAGES ? parseInt(process.env.MAX_NON_ACK_PENDING_MESSAGES) : 10;

export const BALANCE_TOO_LOW_TIMEOUT = process.env.BALANCE_TOO_LOW_TIMEOUT ? parseInt(process.env.BALANCE_TOO_LOW_TIMEOUT) : 60 * 1000;
export const ERROR_TIMEOUT = process.env.ERROR_TIMEOUT ? parseInt(process.env.ERROR_TIMEOUT) : 30 * 1000;
export const REDIS_READ_BLOCK_TIMEOUT = process.env.REDIS_READ_BLOCK_TIMEOUT ? parseInt(process.env.REDIS_READ_BLOCK_TIMEOUT) : 30 * 1000;
export const PROCESSOR_QUEUE_LISTENER_LOOP_MAX_TIMEOUT = process.env.PROCESSOR_QUEUE_LISTENER_LOOP_MAX_TIMEOUT ? parseInt(process.env.PROCESSOR_QUEUE_LISTENER_LOOP_MAX_TIMEOUT) : 60 * 1000;

export const REDIS_URL = process.env.REDIS_URL ?? "redis://redis:6379";

