#!/bin/bash
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Colour

echo -e "${GREEN}"
echo "  _   _      _   _ _            "
echo " | \ | | ___| |_| (_)_ __   ___ "
echo " |  \| |/ _ \ __| | | '_ \ / _ \\"
echo " | |\  |  __/ |_| | | | | |  __/"
echo " |_| \_|\___|\__|_|_|_| |_|\___|"
echo -e "${NC}"

# ── Check dependencies ────────────────────────────────────────────────────────
echo -e "${YELLOW}Checking dependencies...${NC}"

if ! command -v docker &> /dev/null; then
    echo -e "${RED}✗ Docker is not installed. Please install Docker and try again.${NC}"
    echo "  https://docs.docker.com/get-docker/"
    exit 1
fi
echo -e "${GREEN}✓ Docker found${NC}"

if ! docker compose version &> /dev/null; then
    echo -e "${RED}✗ Docker Compose is not available. Please install Docker Compose v2 and try again.${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Docker Compose found${NC}"

# ── Environment file ──────────────────────────────────────────────────────────
if [ ! -f .env ]; then
    echo ""
    echo -e "${YELLOW}No .env file found — creating one from .env.example...${NC}"
    cp .env.example .env
    echo -e "${GREEN}✓ .env created with default values${NC}"
    echo "  Edit .env to change passwords or port before continuing."
    echo ""
    read -p "Press Enter to continue with defaults, or Ctrl+C to edit .env first: "
fi

# ── Build and start ───────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}Building and starting containers...${NC}"
docker compose up --build -d

# ── Wait for db to be healthy ─────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}Waiting for database to be ready...${NC}"
until docker compose exec db mysqladmin ping -h localhost -u netline --password="${MYSQL_PASSWORD:-netlinepassword}" --silent 2>/dev/null; do
    printf '.'
    sleep 2
done
echo ""
echo -e "${GREEN}✓ Database is ready${NC}"

# ── Run migrations ────────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}Running database migrations...${NC}"

# Check if migrations folder exists (i.e. has been initialised before)
if [ -d "prisma/migrations" ] && [ "$(ls -A prisma/migrations)" ]; then
    docker compose exec app npx prisma migrate deploy
    echo -e "${GREEN}✓ Migrations applied${NC}"
else
    echo -e "${YELLOW}No migrations found — creating initial migration...${NC}"
    docker compose exec app npx prisma migrate dev --name init
    echo -e "${GREEN}✓ Database initialised${NC}"
fi

# ── Restart app to pick up fresh migrations ───────────────────────────────────
docker compose restart app

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Netline is running!${NC}"

# Read port from .env if set, default to 3000
PORT=$(grep -E '^PORT=' .env 2>/dev/null | cut -d '=' -f2 | tr -d '[:space:]')
PORT=${PORT:-3000}

echo -e "${GREEN}  Open: http://localhost:${PORT}${NC}"
echo ""
echo -e "  Useful commands:"
echo -e "    Stop:           docker compose down"
echo -e "    Stop + wipe db: docker compose down -v"
echo -e "    Logs:           docker compose logs -f app"
echo -e "    DB browser:     docker compose exec app npx prisma studio"
echo -e "    Import JSON:    docker compose exec app node scripts/import.js /app/graph.json"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
