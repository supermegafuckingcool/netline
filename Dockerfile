FROM node:20-slim

# Install OpenSSL — required by Prisma's query engine
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json package-lock.json* ./
RUN npm install

# Copy Prisma schema and generate client
COPY prisma ./prisma
RUN npx prisma generate

# Copy server and scripts
COPY server.js .
COPY scripts ./scripts

# Copy frontend files from public/ to root so server.js can serve them
COPY public ./public

EXPOSE 3000

# Run migrations then start the server
CMD ["sh", "-c", "npx prisma migrate deploy && node server.js"]
