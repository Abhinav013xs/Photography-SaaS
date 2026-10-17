FROM node:20-alpine AS builder
WORKDIR /app
# Install monorepo dependencies
COPY package.json package-lock.json tsconfig.json ./
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci
COPY . .
# Build the web workspace
RUN npm run build --workspace=@photography-saas/web

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Copy built Next.js output
COPY --from=builder /app/apps/web/.next ./.next
COPY --from=builder /app/apps/web/public ./public
COPY --from=builder /app/apps/web/next.config.mjs ./next.config.mjs
COPY --from=builder /app/apps/web/package.json ./package.json
# Install only production dependencies (next, react, etc.)
RUN npm ci --production
EXPOSE 4000
CMD ["npx", "next", "start", "-p", "4000"]
