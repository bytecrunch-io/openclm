FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/api-spec/package.json packages/api-spec/package.json
RUN npm install
COPY apps/api apps/api
COPY packages/domain packages/domain
COPY packages/api-spec packages/api-spec
RUN npm run api:generate && npm run build -w @bytecrunch/contracts-domain && npm run build -w @bytecrunch/contracts-api

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/packages/domain/dist ./packages/domain/dist
COPY --from=build /app/packages/domain/package.json ./packages/domain/package.json
COPY --from=build /app/packages/api-spec/generated ./packages/api-spec/generated
CMD ["node", "apps/api/dist/index.js"]
