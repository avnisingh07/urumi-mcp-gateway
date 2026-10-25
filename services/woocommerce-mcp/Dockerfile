FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY apps/gateway/package.json apps/gateway/package.json
COPY services/woocommerce-mcp/package.json services/woocommerce-mcp/package.json
COPY services/inventory-mcp/package.json services/inventory-mcp/package.json
COPY services/support-mcp/package.json services/support-mcp/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm ci

COPY services/woocommerce-mcp/ services/woocommerce-mcp/

RUN npm run build --workspace @urumi/woocommerce-mcp


FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/services/woocommerce-mcp/package.json ./services/woocommerce-mcp/package.json
COPY --from=build --chown=node:node /app/services/woocommerce-mcp/dist ./services/woocommerce-mcp/dist

USER node

EXPOSE 3000

CMD ["node", "services/woocommerce-mcp/dist/index.js"]
