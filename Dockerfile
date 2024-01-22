ARG VARIANT=node:20-alpine
# Install dependencies only when needed
FROM ${VARIANT} AS deps
# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install dependencies based on the preferred package manager
COPY package.json package-lock.json* ./
#COPY .npmrc ./
RUN npm ci


# Rebuild the source code only when needed
FROM ${VARIANT} AS builder
ARG INSTANCE=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/src/contracts ./src/contracts
COPY . .

RUN npm run build

# Production image, copy all the files and run next
FROM ${VARIANT} AS runner
ARG INSTANCE=production
WORKDIR /app

ENV NODE_ENV production
# Uncomment the following line in case you want to disable telemetry during runtime.
# ENV NEXT_TELEMETRY_DISABLED 1

RUN apk --no-cache add curl
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
USER nextjs

COPY --from=builder /app/dist ./dist
COPY --from=deps /app/node_modules ./node_modules

EXPOSE 3000

ENV PORT 3000

CMD ["node", "dist/main.js"]
