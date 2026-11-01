# The demo app container (docker-compose.yml, profile "demo"): the web app and the API in
# development mode with fake sign-in, against the compose "sql" service. For trying Stride on a
# computer with only Docker installed (docs/demo.md). Never deployed: Azure runs the built app.
FROM node:22-bookworm-slim

ENV CI=true \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    STRIDE_DEV_HOST=0.0.0.0
RUN corepack enable

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
# The pose model and its WASM runtime, pinned and checksummed (scripts/fetch-models.ts).
RUN pnpm fetch-models

EXPOSE 5173 7071
CMD ["pnpm", "demo:container"]
