FROM oven/bun:1-alpine AS builder
WORKDIR /app
COPY package.json bun.lockb* ./
COPY packages/types ./packages/types
COPY packages/db ./packages/db
COPY packages/realtime ./packages/realtime
RUN bun install --frozen-lockfile --production

FROM oven/bun:1-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
EXPOSE 3001
CMD ["bun", "run", "packages/realtime/src/index.ts"]
