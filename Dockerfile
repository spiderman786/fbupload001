FROM node:20-bookworm-slim

# Native build tools for better-sqlite3; ffmpeg + yt-dlp for reel automation
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    ca-certificates \
    python3 \
    make \
    g++ \
    libsqlite3-dev \
    libsqlite3-0 \
    procps \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build \
  && apt-get update \
  && apt-get purge -y make g++ libsqlite3-dev \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /app/data/downloads

ENV NODE_ENV=production
ENV PORT=3001
ENV DATABASE_PATH=/app/data/fbuploadpro.db

EXPOSE 3001

# Default: web + background worker (prefill queue, scheduler, job processing)
CMD ["npm", "run", "start:production"]
