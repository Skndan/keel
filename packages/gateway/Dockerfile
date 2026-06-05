FROM oven/bun:1-alpine AS builder
WORKDIR /app
COPY package.json bun.lockb* ./
COPY packages/types ./packages/types
COPY packages/db ./packages/db
COPY packages/gateway ./packages/gateway
RUN bun install --frozen-lockfile --production

FROM oven/bun:1-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
EXPOSE 3000
CMD ["bun", "run", "packages/gateway/src/index.ts"]
