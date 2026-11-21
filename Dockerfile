FROM node:22.23.5-trixie-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential python3 python-is-python3 pkg-config libxi-dev libxext-dev libx11-dev mesa-common-dev libgl1-mesa-dev \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build && npm prune --omit=dev

FROM node:22.23.5-trixie-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    libegl1 libgl1 libgl1-mesa-dri libxi6 libxext6 tini xauth xvfb ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir /data && chown node:node /data
COPY --from=build --chown=node:node /app/package*.json /app/next.config.ts /app/
COPY --from=build --chown=node:node /app/.next /app/.next
COPY --from=build --chown=node:node /app/node_modules /app/node_modules
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 LIBGL_ALWAYS_SOFTWARE=1 PORT=3000 TSUMIKI_WORKSPACE=/data
USER node
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "-g", "--"]
CMD ["xvfb-run", "-a", "node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0"]
