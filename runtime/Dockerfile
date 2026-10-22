FROM oven/bun:1.4.0
WORKDIR /executor
COPY LICENSE ./
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY src/ src/
USER bun
ENTRYPOINT ["bun", "--no-env-file", "/executor/src/worker.ts"]
