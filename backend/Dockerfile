# Build from the repo root:  docker build backend   (build context = backend/)
FROM node:22-slim

ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY . .
RUN mkdir -p data && chown -R node:node /app
USER node
# Pre-build the demo-shop git repo (also re-created at startup if the data volume is empty).
RUN node demo-shop/setup-history.js data/demo-shop-repo

ENV PORT=8000
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--experimental-sqlite", "--disable-warning=ExperimentalWarning", "src/server.js"]
