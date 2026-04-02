FROM node:20-slim

# Install OpenSSL — required by Prisma's query engine
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm install

# Generate Prisma client
COPY prisma ./prisma
RUN npx prisma generate

# Copy app code and frontend
COPY server.js .
COPY scripts ./scripts
COPY public ./public

EXPOSE 3000

# Run as non-root user
RUN addgroup --system --gid 1001 netline && \
    adduser  --system --uid 1001 --ingroup netline netline && \
    chown -R netline:netline /app
USER netline

# Deploy migrations (safe to run repeatedly) then start
CMD ["sh", "-c", "npx prisma migrate deploy && node server.js"]
