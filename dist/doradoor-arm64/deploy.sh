#!/bin/bash
set -e

DEPLOY_DIR="/geeknest/doradoor-docker"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PACKAGE_DIR="$SCRIPT_DIR"
TIMESTAMP=$(date +%Y%m%d%H%M)

MODE="full"
if [ "$1" = "--patch" ]; then
    MODE="patch"
elif [ "$1" = "--full" ]; then
    MODE="full"
fi

echo "======================================"
echo "  DoraDoor - Deploy ($MODE)"
echo "======================================"
echo ""

if [ "$MODE" = "patch" ]; then
    echo "[1/4] Stopping container..."
    cd "$DEPLOY_DIR"
    docker compose stop doradoor

    echo ""
    echo "[2/4] Replacing files..."
    cp "$PACKAGE_DIR/doradoor" ./doradoor
    chmod +x ./doradoor
    echo "  Replaced binary"

    rm -rf ./web
    cp -r "$PACKAGE_DIR/web" ./web
    find ./web -name "*.fasthttp.br" -delete 2>/dev/null || true
    echo "  Replaced web/"

    echo ""
    echo "[3/4] Rebuilding and starting..."
    docker compose build --no-cache doradoor
    docker compose up -d doradoor

    echo ""
    echo "[4/4] Checking service..."
    sleep 3
    docker compose logs doradoor --tail=15

    echo ""
    echo "======================================"
    echo "  Patch Deploy DONE!"
    echo "======================================"
else
    echo "[1/6] Stopping old container..."
    cd "$DEPLOY_DIR"
    docker compose down doradoor

    echo ""
    echo "[2/6] Backing up old files..."
    if [ -f doradoor ]; then
        cp doradoor "doradoor.bak.$TIMESTAMP"
        echo "  Backed up binary"
    fi
    if [ -d web ]; then
        cp -r web "web.bak.$TIMESTAMP"
        echo "  Backed up web/"
    fi

    echo ""
    echo "[3/6] Replacing files..."
    cp "$PACKAGE_DIR/doradoor" ./doradoor
    chmod +x ./doradoor
    echo "  Replaced binary"

    rm -rf ./web
    cp -r "$PACKAGE_DIR/web" ./web
    find ./web -name "*.fasthttp.br" -delete 2>/dev/null || true
    echo "  Replaced web/"

    cp "$PACKAGE_DIR/Dockerfile" ./Dockerfile
    echo "  Replaced Dockerfile"

    cp "$PACKAGE_DIR/docker-compose.yml" ./docker-compose.yml
    echo "  Replaced docker-compose.yml"

    cp "$PACKAGE_DIR/prometheus.yml" ./prometheus.yml 2>/dev/null || true
    echo "  Replaced prometheus.yml"

    echo ""
    echo "[4/6] Removing old Docker images..."
    docker images | grep doradoor | awk '{print $3}' | xargs -r docker rmi -f 2>/dev/null || true

    echo ""
    echo "[5/6] Rebuilding and starting..."
    docker compose build --no-cache doradoor
    docker compose up -d doradoor

    echo ""
    echo "[6/6] Checking service..."
    sleep 3
    docker compose logs doradoor --tail=15

    echo ""
    echo "======================================"
    echo "  Full Deploy DONE!"
    echo "======================================"
fi

echo ""
echo "Verify: curl -s http://localhost:3001/health"
echo ""
echo "Usage:"
echo "  bash deploy.sh          # Full deploy (with backup, replace all configs)"
echo "  bash deploy.sh --patch  # Patch deploy (only binary + web, no backup)"
echo ""
echo "Cleanup backups:"
echo "  rm -f /geeknest/doradoor-docker/doradoor.bak.*"
echo "  rm -rf /geeknest/doradoor-docker/web.bak.*"
