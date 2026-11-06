FROM oven/bun:1.4.0 AS bun
FROM node:22.22.0-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY frontend/package.json frontend/package-lock.json frontend/
RUN npm --prefix frontend ci
COPY runtime/package.json runtime/package-lock.json runtime/
RUN npm --prefix runtime ci
COPY . .
RUN npm run build

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
RUN useradd --system --uid 10001 --home /var/lib/orgsdk orgsdk && mkdir -p /var/lib/orgsdk && chown orgsdk:orgsdk /var/lib/orgsdk
COPY --from=build /src/dist/orgsdk /usr/local/bin/orgsdk
USER orgsdk
ENV HOST=0.0.0.0 PORT=8080 ORGSDK_DATA_DIR=/var/lib/orgsdk
VOLUME ["/var/lib/orgsdk"]
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s CMD ["/usr/local/bin/orgsdk", "healthcheck"]
ENTRYPOINT ["/usr/local/bin/orgsdk"]
CMD ["server"]
