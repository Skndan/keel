FROM oven/bun:1-alpine AS builder
WORKDIR /app
COPY package.json bun.lock ./
COPY turbo.json tsconfig.json ./
COPY packages/dashboard/package.json ./packages/dashboard/
RUN bun install --frozen-lockfile
COPY packages/dashboard ./packages/dashboard
RUN cd packages/dashboard && bunx vite build

FROM oven/bun:1-alpine
WORKDIR /app
COPY --from=builder /app/packages/dashboard/dist ./dist
COPY packages/dashboard/server.ts ./
EXPOSE 3003
CMD ["bun", "run", "server.ts"]
