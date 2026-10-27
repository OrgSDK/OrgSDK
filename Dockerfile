FROM oven/bun:1.4.0 AS bun
FROM node:22-slim AS frontend
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /src
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY server/ server/
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
COPY LICENSE /src/LICENSE
COPY runtime/src/ /src/runtime/src/
RUN npm run build

FROM bun AS build
WORKDIR /src
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY server/ server/
COPY --from=frontend /src/frontend/out frontend/out
RUN bun build --compile server/index.ts --asset frontend/out --outfile /orgsdk

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
RUN useradd --system --uid 10001 --home /var/lib/orgsdk orgsdk && mkdir -p /var/lib/orgsdk && chown orgsdk:orgsdk /var/lib/orgsdk
COPY --from=build /orgsdk /usr/local/bin/orgsdk
USER orgsdk
ENV HOST=0.0.0.0 PORT=8080 ORGSDK_DATA_DIR=/var/lib/orgsdk
VOLUME ["/var/lib/orgsdk"]
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s CMD ["/usr/local/bin/orgsdk", "healthcheck"]
ENTRYPOINT ["/usr/local/bin/orgsdk"]
CMD ["server"]
