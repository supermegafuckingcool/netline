#!/bin/bash
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}"
echo "                                                  __"
echo "  _   _      _   _ _                  _    __   _/  \\"
echo " | \ | | ___| |_| (_)_ __   ___      / \\__/  \\_/ \\__/"
echo " |  \| |/ _ \ __| | | | '_ \ / _ \\   \\_/  \\__/  __"
echo " | |\  |  __/ |_| | | | | | |  __/           \\_/  \\"
echo " |_| \_|\___|\__|_|_|_| |_|\___|               \\__/"
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

# ── Environment file ──────────────────────────────────────────────────────────
if [ ! -f .env ]; then
    cp .env.example .env
    echo -e "${GREEN}✓ .env created from defaults${NC}"
    echo ""
    read -p "Press Enter to continue with default passwords, or Ctrl+C to edit .env first: "
fi

MYSQL_PASSWORD_VAL=$(grep -E '^MYSQL_PASSWORD=' .env 2>/dev/null | cut -d= -f2 | tr -d '[:space:]')
MYSQL_PASSWORD_VAL=${MYSQL_PASSWORD_VAL:-netlinepassword}
PORT_VAL=$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2 | tr -d '[:space:]')
PORT_VAL=${PORT_VAL:-3000}

# ── Reset DB prompt ───────────────────────────────────────────────────────────
RESET_DB=false
echo ""
read -p "Reset database? All data will be lost. (y/N): " RESET_ANSWER
if [[ "$RESET_ANSWER" =~ ^[Yy]$ ]]; then
    RESET_DB=true
    echo -e "${YELLOW}Database will be reset.${NC}"
else
    echo -e "${GREEN}Keeping existing data.${NC}"
fi

# ── Wipe DB if requested ──────────────────────────────────────────────────────
if [ "$RESET_DB" = true ]; then
    echo -e "${YELLOW}Stopping and wiping database volume...${NC}"
    docker compose down -v 2>/dev/null || true
fi

# ── Build and start ───────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}Building and starting containers...${NC}"
docker compose up --build -d

# ── Wait for database ─────────────────────────────────────────────────────────
echo -e "${YELLOW}Waiting for database...${NC}"
until docker compose exec db mysqladmin ping -h localhost -u netline \
    --password="$MYSQL_PASSWORD_VAL" --silent 2>/dev/null; do
    printf '.'
    sleep 2
done
echo ""
echo -e "${GREEN}✓ Database ready${NC}"

# ── Migrations ────────────────────────────────────────────────────────────────
echo -e "${YELLOW}Running migrations...${NC}"
if [ ! -d "prisma/migrations" ] || [ -z "$(ls -A prisma/migrations 2>/dev/null)" ]; then
    # No migration files yet — generate them directly from the schema using db push,
    # then create a baseline migration so deploy works from now on
    docker compose exec -T app npx prisma db push --skip-generate
    echo -e "${GREEN}  Schema pushed — creating baseline migration...${NC}"
    docker compose exec -T app npx prisma migrate resolve --applied 0_init 2>/dev/null || true
else
    docker compose exec -T app npx prisma migrate deploy
fi
echo -e "${GREEN}✓ Database ready${NC}"

# ── Restart app to pick up migrations ────────────────────────────────────────
docker compose restart app

# ── Save images for offline use (only if --export flag given) ─────────
if [[ " $* " == *" --export "* ]]; then
    echo ""
    echo -e "${YELLOW}Saving images for offline deployment...${NC}"
    APP_IMAGE=$(docker compose images -q app)
    docker tag "$APP_IMAGE" netline:latest 2>/dev/null || true
    docker save netline:latest | gzip > netline-app.tar.gz
    docker save mysql:8.0      | gzip > netline-mysql.tar.gz
    echo -e "${GREEN}✓ Saved netline-app.tar.gz and netline-mysql.tar.gz${NC}"
    echo "  Copy these alongside the repo to deploy on machines without internet."
fi

# ── Done ──────────────────────────────────────────────────────────────────────
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
