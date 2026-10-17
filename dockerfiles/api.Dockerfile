FROM node:20-alpine AS builder
WORKDIR /app
# Install workspace dependencies
COPY package.json package-lock.json tsconfig.json ./
COPY apps/api/package.json ./apps/api/package.json
RUN npm ci
COPY . .
# Build the API workspace
RUN npm run build --workspace=@photography-saas/api

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Copy built artefacts
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/package.json ./package.json
# Install only production dependencies
RUN npm ci --production
EXPOSE 3000
CMD ["node", "dist/server.js"]
