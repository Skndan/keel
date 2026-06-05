FROM oven/bun:1-alpine AS builder
WORKDIR /app
COPY packages/dashboard ./packages/dashboard
RUN cd packages/dashboard && bun install --frozen-lockfile --production

FROM oven/bun:1-alpine
WORKDIR /app
COPY --from=builder /app/packages/dashboard ./packages/dashboard
EXPOSE 3003
CMD ["bun", "run", "packages/dashboard/server.ts"]
