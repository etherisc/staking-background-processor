import { StaticJsonRpcProvider } from '@ethersproject/providers';
import * as dotenv from 'dotenv';
import { Signer, Wallet } from 'ethers';
import { formatEther, formatUnits } from 'ethers/lib/utils';
import { initializeApi } from './api';
import { CHAIN_RPC_URL, STAKING_ADDRESS, MAX_FEE_PER_GAS, PROCESSOR_MIN_BALANCE, PROCESSOR_MNEMONIC, MAX_PRIORITY_FEE_PER_GAS, PROCESSOR_ALERT_BALANCE } from './constants';
import QueueListener from './queuelistener';
import { logger } from './logger';

dotenv.config();

class Main {

    constructor() {
    }

    public async main(): Promise<void> {
        const stakingProductAddress = STAKING_ADDRESS;
        logger.info("stakingProductAddress: " + stakingProductAddress);
        const processorMnemonic = PROCESSOR_MNEMONIC;
        const maxFeePerGas = MAX_FEE_PER_GAS;
        const maxPriorityFeePerGas = MAX_PRIORITY_FEE_PER_GAS;
        logger.info("maxFeePerGas: " + formatUnits(maxFeePerGas, "gwei") + " gwei");
        const processorMinBalance = PROCESSOR_MIN_BALANCE;
        logger.info("processorMinBalance: " + formatEther(processorMinBalance) + " eth");
        const processorAlertBalance = PROCESSOR_ALERT_BALANCE;
        logger.info("processorAlertBalance: " + formatEther(processorAlertBalance) + " eth");

        if (processorAlertBalance.lt(processorMinBalance)) {
            throw new Error("processorAlertBalance must be greater than processorMinBalance");
        }
        
        const provider = new StaticJsonRpcProvider(CHAIN_RPC_URL);
        const signer: Signer = Wallet.fromMnemonic(processorMnemonic).connect(provider);

        logger.info("processor address: " + await signer.getAddress());

        initializeApi(signer, processorAlertBalance);

        // initializeRedis();
        new QueueListener().listen(stakingProductAddress, signer, maxFeePerGas, maxPriorityFeePerGas, processorMinBalance);
    }

}

new Main().main();
