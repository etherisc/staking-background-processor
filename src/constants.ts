import { BigNumber } from "ethers";
import { parseEther } from "ethers/lib/utils";
import * as dotenv from 'dotenv';

dotenv.config();

export const APPLICATION_ID = process.env.REDIS_QUEUE_APPLICATION_ID ?? "staking-backend-processor";
export const CONSUMER_ID = process.env.REDIS_QUEUE_CONSUMER_ID ?? "staking-backend-processor-consumer";
export const STREAM_KEY = process.env.REDIS_QUEUE_STREAM_KEY ?? "application:signatures";

export const DEPEG_PRODUCT_ADDRESS = process.env.DEPEG_PRODUCT_ADDRESS ?? "";
export const PROCESSOR_MNEMONIC = process.env.PROCESSOR_MNEMONIC ?? "";
export const MAX_FEE_PER_GAS = BigNumber.from(process.env.MAX_FEE_PER_GAS || 30000000000);
export const PROCESSOR_EXPECTED_BALANCE = process.env.PROCESSOR_EXPECTED_BALANCE ? BigNumber.from(process.env.PROCESSOR_EXPECTED_BALANCE) : parseEther("1.0");
export const CHAIN_RPC_URL = process.env.CHAIN_RPC_URL ?? "";
export const CHAIN_MINUMUM_REQUIRED_CONFIRMATIONS = process.env.CHAIN_MINUMUM_REQUIRED_CONFIRMATIONS ? parseInt(process.env.CHAIN_MINUMUM_REQUIRED_CONFIRMATIONS) : 6;
export const MAX_NON_ACK_PENDING_MESSAGES = process.env.MAX_NON_ACK_PENDING_MESSAGES ? parseInt(process.env.MAX_NON_ACK_PENDING_MESSAGES) : 10;

export const BALANCE_TOO_LOW_TIMEOUT = process.env.BALANCE_TOO_LOW_TIMEOUT ? parseInt(process.env.BALANCE_TOO_LOW_TIMEOUT) : 60 * 1000;
export const ERROR_TIMEOUT = process.env.ERROR_TIMEOUT ? parseInt(process.env.ERROR_TIMEOUT) : 30 * 1000;
export const REDIS_READ_BLOCK_TIMEOUT = process.env.REDIS_READ_BLOCK_TIMEOUT ? parseInt(process.env.REDIS_READ_BLOCK_TIMEOUT) : 30 * 1000;
export const PROCESSOR_QUEUE_LISTENER_LOOP_MAX_TIMEOUT = process.env.PROCESSOR_QUEUE_LISTENER_LOOP_MAX_TIMEOUT ? parseInt(process.env.PROCESSOR_QUEUE_LISTENER_LOOP_MAX_TIMEOUT) : 60 * 1000;
