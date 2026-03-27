#!/bin/bash
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}"
echo "  _   _      _   _ _            "
echo " | \ | | ___| |_| (_)_ __   ___ "
echo " |  \| |/ _ \ __| | | | '_ \ / _ \\"
echo " | |\  |  __/ |_| | | | | | |  __/"
echo " |_| \_|\___|\__|_|_|_| |_|\___|"
echo -e "${NC}"

# ── Check Docker ──────────────────────────────────────────────────────────────
if ! command -v docker &> /dev/null; then
    echo -e "${RED}✗ Docker not installed. See https://docs.docker.com/get-docker/${NC}"
    exit 1
fi
if ! docker compose version &> /dev/null; then
    echo -e "${RED}✗ Docker Compose v2 not available.${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Docker found${NC}"

# ── Images ────────────────────────────────────────────────────────────────────
if [ -f "netline-app.tar.gz" ] && [ -f "netline-mysql.tar.gz" ] && ! docker image inspect netline:latest &>/dev/null; then
    # Tar files present but image not loaded yet — load them
    echo -e "${YELLOW}Loading images from tar files...${NC}"
    docker load < netline-mysql.tar.gz
    docker load < netline-app.tar.gz
    echo -e "${GREEN}✓ Images loaded${NC}"
    START_CMD="docker compose up -d"

elif docker image inspect netline:latest &>/dev/null && docker image inspect mysql:8.0 &>/dev/null; then
    # Images already loaded — skip build
    echo -e "${GREEN}✓ Images already built — skipping build${NC}"
    START_CMD="docker compose up -d"

else
    # No images, no tars — build from source (requires internet)
    echo -e "${YELLOW}Building from source (internet required)...${NC}"
    START_CMD="docker compose up --build -d"
fi

# ── Environment file ──────────────────────────────────────────────────────────
if [ ! -f .env ]; then
    cp .env.example .env
    echo -e "${GREEN}✓ .env created from defaults${NC}"
    echo ""
    read -p "Press Enter to continue with default passwords, or Ctrl+C to edit .env first: "
fi

# ── Start containers ──────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}Starting containers...${NC}"
$START_CMD

# ── Wait for database ─────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}Waiting for database...${NC}"
MYSQL_PASSWORD_VAL=$(grep -E '^MYSQL_PASSWORD=' .env 2>/dev/null | cut -d= -f2 | tr -d '[:space:]')
MYSQL_PASSWORD_VAL=${MYSQL_PASSWORD_VAL:-netlinepassword}

until docker compose exec db mysqladmin ping -h localhost -u netline \
    --password="$MYSQL_PASSWORD_VAL" --silent 2>/dev/null; do
    printf '.'
    sleep 2
done
echo ""
echo -e "${GREEN}✓ Database ready${NC}"

# ── Run migrations ────────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}Running migrations...${NC}"
if [ -d "prisma/migrations" ] && [ "$(ls -A prisma/migrations 2>/dev/null)" ]; then
    docker compose exec app npx prisma migrate deploy
    echo -e "${GREEN}✓ Migrations applied${NC}"
else
    echo -e "${YELLOW}First run — creating initial migration...${NC}"
    docker compose exec app npx prisma migrate dev --name init
    echo -e "${GREEN}✓ Database initialised${NC}"
fi

# ── Restart app to pick up migrations ────────────────────────────────────────
docker compose restart app

# ── Save images for offline use (only after a fresh build) ───────────────────
if [ ! -f "netline-app.tar.gz" ]; then
    echo ""
    echo -e "${YELLOW}Saving images for future offline use...${NC}"
    # Tag the app image with a stable name then save
    APP_IMAGE=$(docker compose images -q app)
    docker tag "$APP_IMAGE" netline:latest
    docker save netline:latest | gzip > netline-app.tar.gz
    docker save mysql:8.0      | gzip > netline-mysql.tar.gz
    echo -e "${GREEN}✓ Saved netline-app.tar.gz and netline-mysql.tar.gz${NC}"
    echo "  Copy these alongside the repo to deploy on machines without internet."
fi

# ── Done ──────────────────────────────────────────────────────────────────────
PORT_VAL=$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2 | tr -d '[:space:]')
PORT_VAL=${PORT_VAL:-3000}

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Netline is running!${NC}"
echo -e "${GREEN}  Open: http://localhost:${PORT_VAL}${NC}"
echo ""
echo    "  Commands:"
echo    "    Stop:              docker compose down"
echo    "    Stop + wipe db:    docker compose down -v"
echo    "    Logs:              docker compose logs -f app"
echo    "    DB browser:        docker compose exec app npx prisma studio"
echo    "    Import graph.json: docker compose cp graph.json app:/app/graph.json"
echo    "                       docker compose exec app node scripts/import.js /app/graph.json"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
