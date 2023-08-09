import { StaticJsonRpcProvider } from '@ethersproject/providers';
import * as dotenv from 'dotenv';
import { Signer, Wallet } from 'ethers';
import { formatEther, formatUnits } from 'ethers/lib/utils';
import { initializeApi } from './api';
import { CHAIN_RPC_URL, DEPEG_PRODUCT_ADDRESS, MAX_FEE_PER_GAS, PROCESSOR_EXPECTED_BALANCE, PROCESSOR_MNEMONIC } from './constants';
import QueueListener from './queuelistener';
import { logger } from './logger';

dotenv.config();

class Main {

    constructor() {
    }

    public async main(): Promise<void> {
        const depegProductAddress = DEPEG_PRODUCT_ADDRESS;
        logger.info("depegProductAddress: " + depegProductAddress);
        const processorMnemonic = PROCESSOR_MNEMONIC;
        const maxFeePerGas = MAX_FEE_PER_GAS;
        logger.info("maxFeePerGas: " + formatUnits(maxFeePerGas, "gwei") + " gwei");
        const processorExpectedBalance = PROCESSOR_EXPECTED_BALANCE;
        logger.info("processorExpectedBalance: " + formatEther(processorExpectedBalance) + " eth");
        
        const provider = new StaticJsonRpcProvider(CHAIN_RPC_URL);
        const signer: Signer = Wallet.fromMnemonic(processorMnemonic).connect(provider);

        logger.info("processor address: " + await signer.getAddress());

        initializeApi(signer, processorExpectedBalance);

        // initializeRedis();
        new QueueListener().listen(depegProductAddress, signer, maxFeePerGas, processorExpectedBalance);
    }

}

new Main().main();
