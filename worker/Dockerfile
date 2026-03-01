# Worker image: Node + circom + snarkjs (installed via repo root)
FROM node:20-bullseye

# Install circom (prebuilt)
RUN apt-get update && apt-get install -y curl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN curl -L -o /usr/local/bin/circom https://github.com/iden3/circom/releases/download/v2.1.6/circom-linux-amd64 \
  && chmod +x /usr/local/bin/circom

WORKDIR /app

# Copy repo
COPY . /app

# Install root deps (includes snarkjs via patch)
RUN npm ci --omit=optional

# Install blockchain deps (hardhat)
RUN cd blockchain && npm ci --omit=optional

# Install worker deps
RUN cd worker && npm ci --omit=optional

CMD ["node", "worker/src/index.js"]
