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
echo " |  \| |/ _ \ __| | | |_ _\\/ _ \\     \\_/  \\__/  __"
echo " | |\  |  __/ |_| | | | | |  __/             \\_/  \\"
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
if [ -f netline-app.tar.gz ] && [ -f netline-mysql.tar.gz ]; then
    # Offline bundle detected — always wipe the volume so no stale data leaks in
    RESET_DB=true
    echo -e "${YELLOW}Offline bundle detected — wiping any existing database volume.${NC}"
else
    echo ""
    read -p "Reset database? All data will be lost. (y/N): " RESET_ANSWER
    if [[ "$RESET_ANSWER" =~ ^[Yy]$ ]]; then
        RESET_DB=true
        echo -e "${YELLOW}Database will be reset.${NC}"
    else
        echo -e "${GREEN}Keeping existing data.${NC}"
    fi
fi

# ── Wipe DB if requested ──────────────────────────────────────────────────────
if [ "$RESET_DB" = true ]; then
    echo -e "${YELLOW}Stopping and wiping database volume...${NC}"
    docker compose down -v 2>/dev/null || true
fi

# ── Load offline images if present ───────────────────────────────────────────
OFFLINE=false
if [ -f netline-app.tar.gz ] && [ -f netline-mysql.tar.gz ]; then
    OFFLINE=true
    echo -e "${YELLOW}Offline images found — loading...${NC}"
    docker load < netline-app.tar.gz
    docker load < netline-mysql.tar.gz
    rm netline-app.tar.gz netline-mysql.tar.gz
    echo -e "${GREEN}✓ Images loaded${NC}"
fi

# ── Build and start ───────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}Starting containers...${NC}"
if [ "$OFFLINE" = true ]; then
    # Skip --build entirely — images are already loaded, no internet needed
    docker compose up -d
else
    docker compose up --build -d
fi

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
if [ "$OFFLINE" = true ]; then
    # Offline bundle: schema was applied during image build — nothing to do
    echo -e "${GREEN}✓ Schema ready (offline bundle)${NC}"
else
    if [ ! -d "prisma/migrations" ] || [ -z "$(ls -A prisma/migrations 2>/dev/null)" ]; then
        docker compose exec -T app npx prisma db push --skip-generate
        echo -e "${GREEN}  Schema pushed — creating baseline migration...${NC}"
        docker compose exec -T app npx prisma migrate resolve --applied 0_init 2>/dev/null || true
    else
        docker compose exec -T app npx prisma migrate deploy
    fi
    echo -e "${GREEN}✓ Schema applied${NC}"

    # Restart to pick up any migration changes
    docker compose restart app
fi

# ── Restore database dump if present (from --export-with-db bundle) ──────────
if [ -f netline-dump.sql ]; then
    echo -e "${YELLOW}Database snapshot found — restoring...${NC}"
    docker compose exec -T db mysql         -u netline --password="$MYSQL_PASSWORD_VAL" netline         < netline-dump.sql
    rm netline-dump.sql
    echo -e "${GREEN}✓ Database restored${NC}"
fi

# ── Export bundle ─────────────────────────────────────────────────────────────
# --export        clean slate (Docker images only, no database data)
# --export-with-db  includes a dump of the current database

EXPORT_MODE=""
if [[ " $* " == *" --export-with-db "* ]]; then
    EXPORT_MODE="with-db"
elif [[ " $* " == *" --export "* ]]; then
    EXPORT_MODE="clean"
fi

if [ -n "$EXPORT_MODE" ]; then
    echo ""
    REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    BUNDLE_DIR=$(mktemp -d)

    if [ "$EXPORT_MODE" = "with-db" ]; then
        echo -e "${YELLOW}Building offline bundle with database snapshot...${NC}"
    else
        echo -e "${YELLOW}Building clean offline bundle...${NC}"
    fi

    # Save Docker images
    echo -e "${YELLOW}  Saving Docker images...${NC}"
    APP_IMAGE=$(docker compose images -q app)
    docker tag "$APP_IMAGE" netline:latest 2>/dev/null || true
    docker save netline:latest | gzip > "$BUNDLE_DIR/netline-app.tar.gz"
    docker save mysql:8.0      | gzip > "$BUNDLE_DIR/netline-mysql.tar.gz"

    # Copy project files (exclude node_modules, .git, and any existing bundles)
    echo -e "${YELLOW}  Copying project files...${NC}"
    mkdir -p "$BUNDLE_DIR/netline"
    tar -cf - -C "$REPO_DIR" \
        --exclude='./node_modules' \
        --exclude='./.git' \
        --exclude='./netline.tar.gz' \
        --exclude='./netline-app.tar.gz' \
        --exclude='./netline-mysql.tar.gz' \
        . | tar -xf - -C "$BUNDLE_DIR/netline"

    # Move images inside the project folder so start.sh auto-loads them
    mv "$BUNDLE_DIR/netline-app.tar.gz"   "$BUNDLE_DIR/netline/"
    mv "$BUNDLE_DIR/netline-mysql.tar.gz" "$BUNDLE_DIR/netline/"

    # Dump database if requested
    if [ "$EXPORT_MODE" = "with-db" ]; then
        echo -e "${YELLOW}  Dumping database...${NC}"
        docker compose exec -T db mysqldump             -u netline --password="$MYSQL_PASSWORD_VAL"             --single-transaction --quick netline             > "$BUNDLE_DIR/netline/netline-dump.sql"
        echo -e "${GREEN}  ✓ Database snapshot included${NC}"
    fi

    # Pack everything into a single archive
    tar -czf "$REPO_DIR/netline.tar.gz" -C "$BUNDLE_DIR" netline
    rm -rf "$BUNDLE_DIR"

    echo -e "${GREEN}✓ netline.tar.gz created${NC}"
    echo ""
    echo "  To deploy on an offline machine:"
    echo "    1. Copy netline.tar.gz to the target machine"
    echo "    2. tar -xzf netline.tar.gz"
    echo "    3. cd netline && ./start.sh"
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
