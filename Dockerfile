# Tributary production images. Three targets from one workspace layer:
#   tributary — the API + workers (tsx), serving the built console from /app/apps/console/dist
#   gate      — the permission service
#   mcp       — not deployed on the box; published as a package for agents
# See infra/production/compose.yml and docs/deployment.md.
FROM node:22-bookworm-slim AS workspace
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.18.2 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json .npmrc ./
COPY apps ./apps
COPY packages ./packages
COPY fixtures ./fixtures
RUN pnpm install --frozen-lockfile

FROM workspace AS console-build
RUN pnpm --filter @tributary/console build

FROM workspace AS tributary
ENV NODE_ENV=production
COPY --from=console-build /app/apps/console/dist /app/apps/console/dist
ENV CONSOLE_DIST=/app/apps/console/dist
USER node
EXPOSE 4100
WORKDIR /app/apps/tributary
CMD ["node_modules/.bin/tsx", "src/index.ts"]

FROM workspace AS gate
ENV NODE_ENV=production
RUN mkdir -p /data/gate-blobs && chown node:node /data/gate-blobs
USER node
EXPOSE 4200
WORKDIR /app/apps/gate
CMD ["node_modules/.bin/tsx", "src/index.ts"]
