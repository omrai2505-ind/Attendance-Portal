# Multi-runtime Dockerfile (Node.js 20 + Python 3.11 + OpenCV)
# Perfect for 100% FREE deployment on Render, Koyeb, or Railway
FROM node:20-bookworm-slim

# Install Python 3, venv, and system libraries required by OpenCV headless
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    libglib2.0-0 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 1. Setup Python Virtual Environment and Inference Dependencies
COPY inference/requirements.txt ./inference/requirements.txt
RUN python3 -m venv ./inference/.venv && \
    ./inference/.venv/bin/pip install --no-cache-dir --upgrade pip && \
    ./inference/.venv/bin/pip install --no-cache-dir -r ./inference/requirements.txt

# Copy Inference application and model weights
COPY inference/ ./inference/

# 2. Setup Node.js Server Dependencies
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --only=production

# 3. Copy Server and Static Frontend files
COPY server/ ./
COPY public/ ../public/
COPY scripts/ ../scripts/

# Expose default HTTP port
EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

# Start server (which automatically supervises and runs the Python inference service)
CMD ["node", "server.js"]
