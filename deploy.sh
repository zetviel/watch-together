#!/bin/bash
set -e

# ==============================================================================
# WatchTogether Auto-Deploy Script
# Domain: watch-together.nlpha.shop
# Path: /opt/watch-together
# ==============================================================================

PROJECT_DIR="/opt/watch-together"
REPO_URL="git@github.com:zetviel/watch-together.git"
SERVICE_NAME="watch-together"
REMNANODE_DIR="/opt/remnawave"

echo "========================================="
echo " Starting WatchTogether Auto-Deployment"
echo "========================================="

# 1. Ensure directory exists or clone
if [ ! -d "$PROJECT_DIR/.git" ]; then
    echo "[1/6] Cloning repository to $PROJECT_DIR..."
    mkdir -p "$PROJECT_DIR"
    git clone "$REPO_URL" "$PROJECT_DIR"
else
    echo "[1/6] Pulling latest changes from Git..."
    cd "$PROJECT_DIR"
    git fetch --all
    git reset --hard origin/main || git reset --hard origin/master || git pull
fi

cd "$PROJECT_DIR"

# 2. Ensure .env exists with production secrets
if [ ! -f "$PROJECT_DIR/.env" ]; then
    echo "[2/6] Creating default production .env..."
    cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
    sed -i 's/PORT=7788/PORT=7788/g' "$PROJECT_DIR/.env"
    sed -i 's|BASE_URL=https://watch-together.nlpha.shop|BASE_URL=https://watch-together.nlpha.shop|g' "$PROJECT_DIR/.env"
fi

# 3. Install NPM dependencies
echo "[3/6] Installing dependencies..."
npm install --omit=dev

# 4. Ensure yt-dlp is available
if ! command -v yt-dlp &> /dev/null; then
    echo "[4/6] Installing yt-dlp..."
    pip3 install --no-cache-dir -U yt-dlp || true
else
    echo "[4/6] yt-dlp is already installed."
fi

# 5. Setup / Restart Systemd Service
echo "[5/6] Updating systemd service..."
cp "$PROJECT_DIR/watch-together.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

# 6. Quick Nginx Reload (does not restart full docker stack)
echo "[6/6] Reloading Nginx in remnawave..."
if docker ps | grep -q "remnawave-nginx"; then
    docker exec remnawave-nginx nginx -s reload || docker compose -f "$REMNANODE_DIR/docker-compose.yml" restart remnawave-nginx
    echo "Nginx successfully reloaded!"
else
    echo "Warning: remnawave-nginx container is not running!"
fi

echo "========================================="
echo " Deployment Complete!"
echo " Service Status: $(systemctl is-active $SERVICE_NAME)"
echo " URL: https://watch-together.nlpha.shop"
echo "========================================="
