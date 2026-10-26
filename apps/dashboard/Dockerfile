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
COPY apps/dashboard/ apps/dashboard/
RUN npm run build --workspace @urumi/dashboard

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY apps/dashboard/deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/dashboard/dist /usr/share/nginx/html
EXPOSE 8080
