FROM node:22.22.0-bookworm-slim AS dependencies
WORKDIR /executor
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM oven/bun:1.4.0
WORKDIR /executor
COPY LICENSE ./
COPY package.json ./
COPY --from=dependencies /executor/node_modules node_modules
COPY src/ src/
USER bun
ENTRYPOINT ["bun", "--no-env-file", "/executor/src/worker.ts"]
