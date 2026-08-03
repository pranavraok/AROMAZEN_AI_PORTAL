FROM node:22-alpine AS base
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --ignore-scripts

FROM base AS build
ARG BACKEND_API_ORIGIN=http://localhost:8000
ENV BACKEND_API_ORIGIN=$BACKEND_API_ORIGIN
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN corepack enable && pnpm build

FROM base AS runtime
ENV NODE_ENV=production
RUN corepack enable
COPY --from=build /app .
EXPOSE 3000
CMD ["pnpm", "start"]
