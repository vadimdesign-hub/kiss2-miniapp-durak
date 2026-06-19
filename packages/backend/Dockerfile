FROM node:24-alpine AS build
WORKDIR /app
COPY ./ /app/
ARG NODE_AUTH_TOKEN
ENV NODE_AUTH_TOKEN=${NODE_AUTH_TOKEN}

RUN npm ci --workspace=packages/backend
RUN npx prisma generate --schema=packages/backend/prisma/schema.prisma && \
    npm run --workspace=packages/backend build

FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY --from=build /app/node_modules node_modules/
COPY --from=build /app/packages/backend/dist packages/backend/dist/
COPY --from=build /app/packages/backend/src/generated/prisma/*.node packages/backend/dist/generated/prisma/
COPY --from=build /app/packages/backend/package.json packages/backend/
COPY --from=build /app/packages/backend/prisma packages/backend/prisma/
WORKDIR /app/packages/backend
CMD ["node", "--import", "./dist/instrument.js", "dist/index.js"]
