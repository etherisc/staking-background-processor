# staking-backend-processor

This service is a background processor that listens on a redis queue for new stake and restake actions that are to be submitted to the blockchain. 

This is used to provide a feeless service (if the user chooses the option 'I would like Etherisc to submit the transaction and pay fees on by behalf').


## Environment variables

- `REDIS_URL`: the URL of the Redis instance used
- `CHAIN_RPC_URL`: the URL of the Ethereum node used
- `CHAIN_MINUMUM_REQUIRED_CONFIRMATIONS`: the minimum number of confirmations required for a transaction to be considered confirmed and purged from redis
- `NODE_ENV`: the environment of the application 

- `STAKING_PRODUCT_ADDRESS`: the address of the staking product
- `PROCESSOR_EXPECTED_BALANCE`: the minimum expected balance of the processor (should be large enough to pay for one application at the given gas price)
- `PROCESSOR_MNEMONIC`: the mnemonic of the processor
- `MAX_FEE_PER_GAS`: the maximum fee per gas to use for the application
- `MAX_NON_ACK_PENDING_MESSAGES`: the maximum number of pending messages on the applications redis stream (queue) that are not acknowledged (i.e. not processed yet)

- `BALANCE_TOO_LOW_TIMEOUT`: the timeout in milliseconds to wait before retrying to submit an application if the balance is too low
- `ERROR_TIMEOUT`: the timeout in milliseconds to wait before retrying to submit an application if an error occurred
- `REDIS_READ_BLOCK_TIMEOUT`: the timeout in milliseconds to block while reading from redis stream (queue)
- `PROCESSOR_QUEUE_LISTENER_LOOP_MAX_TIMEOUT`: TODO
- `PORT`: the http port the API listens on

## API

### Monitor (`/api/monitor`)

To monitor the instance, create a check in your monitoring tool that calls the `/api/monitor` endpoint. The endpoint returns a 200 status code if the instance is healthy, otherwise it returns a 500 status code.

The call checks the following:
- `balance`: the balance of the processor is above the expected balance (see `PROCESSOR_EXPECTED_BALANCE`)
- `processor`: the processor loop was executed at least once in the last 3 minutes (configurable via `PROCESSOR_QUEUE_LISTENER_LOOP_MAX_TIMEOUT`)
- `nonAckPendingTx`: the number of pending messages on the applications redis stream (queue) that are not acknowledged (i.e. not processed yet) (see `MAX_NON_ACK_PENDING_MESSAGES`)

## Execution

### Local (for dev)

`npm run dev`

### Docker

```
docker build -t staking-backend-processor .
docker run -d --name staking-backend-processor -p 3000:3000 staking-backend-processor
```


## Deployment

### Dokku

We use [dokku](https://dokku.com/) for deployment. 

With the current setup (dokku repo is added as remote repo called `dokku` to the local git), deployment is triggered by running the following command in the root directory of the project:

```
git push dokku <branch-to-deploy>:main
```

#### Initial instance setup

Replace application name (`goerli-setup`) with whatever fits your need. DNS is expected to be prepared in advance.


```
# create dokku application 
dokku apps:create mumbai-staking-processor

# add new domain and remove default domain
dokku domains:add mumbai-staking-processor processor.mumbai.etherisc.com
dokku domains:remove mumbai-staking-processor mumbai-staking-processor.depeg-test.etherisc.com

# set correct proxy ports for http and https
dokku proxy:ports-add mumbai-staking-processor https:443:3000
dokku proxy:ports-add mumbai-staking-processor http:80:3000
dokku proxy:ports-remove mumbai-staking-processor http:80:5000

# link existing redis service from depeg-ui
dokku redis:link depeg-mumbai-redis mumbai-staking-processor

# disable zero downtime deployments (to avoid duplicate queue listeners)
dokku checks:disable mumbai-staking-processor

# configure environment variables (see above)
dokku config:set mumbai-staking-processor ...

# now push deployment via git 
# 1. add new git remote 'git remote add dokku-mumbai dokku@<host>:mumbai-staking-processor'
# 2. 'git push dokku-mumbai develop:main'

# enable let's encrypt for https certificates
dokku letsencrypt:enable mumbai-staking-processor
```
