# Production Deployment Guide

This document describes the steps required to deploy **Photography‑SaaS** to a production environment (e.g., Hostinger VPS or any Linux server). All steps assume you have **Docker 20+**, **Docker‑Compose**, and **Nginx** installed on the target host.

---

## 1. Prerequisites

1. **Server** – Ubuntu 22.04 LTS (or compatible) with at least 2 CPU, 4 GB RAM, 50 GB SSD.
2. **Docker & Docker‑Compose**
   ```bash
   sudo apt-get update
   sudo apt-get install -y ca-certificates curl gnupg lsb-release
   curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --yes --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
   echo \
     "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] \
     https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | \
     sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
   sudo apt-get update
   sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
   sudo usermod -aG docker $USER   # optional, log out/in afterwards
   ```
3. **Nginx** (for TLS termination and reverse‑proxy)
   ```bash
   sudo apt-get install -y nginx
   ```
4. **Domain & TLS** – Obtain a domain pointing to the server IP and generate a Let's Encrypt certificate (certbot). Example:
   ```bash
   sudo apt-get install -y certbot python3-certbot-nginx
   sudo certbot --nginx -d example.com -d www.example.com
   ```

---

## 2. Repository Preparation

1. Clone the repository on the server:
   ```bash
   git clone https://github.com/your‑org/photography‑saas.git
   cd photography‑saas
   ```
2. Copy the production environment template:
   ```bash
   cp .env.example .env.production
   ```
   Edit `.env.production` and set the required values:
   - `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`
   - `REDIS_HOST` (usually `redis` – Docker service name)
   - Cloudflare R2 credentials: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
   - `JWT_SECRET` – at least 32 characters, random.
   - `AI_SERVICE_URL` – URL of the FastAPI face‑search service (e.g., `http://api:3000`).
   - `APP_URL` – public base URL (e.g., `https://example.com`).
   Ensure **no secret** is checked into version control.

---

## 3. Build & Deploy

### 3.1 Build Docker images
```bash
docker compose -f infrastructure/docker/docker-compose.prod.yml build
```
This will invoke the multi‑stage Dockerfiles located in `dockerfiles/api.Dockerfile` and `dockerfiles/web.Dockerfile`.

### 3.2 Start the stack
```bash
docker compose -f infrastructure/docker/docker-compose.prod.yml up -d
```
The stack consists of:
- `prod_postgres`
- `prod_redis`
- `prod_api` (exposes **3000** inside the container, mapped to host **3000**)
- `prod_web` (exposes **4000**, mapped to host **4000**)

### 3.3 Verify health endpoints
```bash
curl http://localhost:3000/health
curl http://localhost:4000
```
Both should return a JSON object containing `{ "status": "ok" }`.

---

## 4. Nginx Reverse‑Proxy

Create `/etc/nginx/sites‑available/photography-saas.conf` with the following content (replace `example.com` with your domain):
```nginx
server {
    listen 80;
    server_name example.com www.example.com;
    # Redirect HTTP → HTTPS
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name example.com www.example.com;

    ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;

    # Security headers (per Phase 26 hardening)
    add_header Content-Security-Policy "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'";
    add_header X-Content-Type-Options "nosniff";
    add_header X-Frame-Options "DENY";
    add_header Referrer-Policy "no-referrer";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload";

    # API proxy
    location /api/ {
        proxy_pass http://localhost:3000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Web UI proxy – all other traffic
    location / {
        proxy_pass http://localhost:4000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
Enable the site and reload Nginx:
```bash
sudo ln -s /etc/nginx/sites-available/photography-saas.conf /etc/nginx/sites-enabled/
sudo nginx -t   # verify syntax
sudo systemctl reload nginx
```
Now the application is reachable at `https://example.com`.

---

## 5. Process Management (Alternative to Docker)

If you prefer to run the services directly on the host (e.g., on a VPS without Docker), use the **PM2** ecosystem file created at `pm2/ecosystem.config.cjs`:
```bash
npm install -g pm2
pm2 start pm2/ecosystem.config.cjs
pm2 save   # persist across reboots
```
Make sure PostgreSQL and Redis are installed and running locally, and that the `.env.production` file is sourced (`export $(cat .env.production | xargs)` before launching PM2.

---

## 6. Continuous Integration (CI) – Production Build

The CI workflow (`.github/workflows/ci.yml`) already runs lint, type‑check, unit & E2E tests, and a production build (`npm run build`). To also validate the production Docker images, add the following **optional** job:
```yaml
  build_prod:
    name: Build Production Docker Images
    runs-on: ubuntu-latest
    needs: validate
    steps:
      - uses: actions/checkout@v4
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3
      - name: Build API image
        run: docker compose -f infrastructure/docker/docker-compose.prod.yml build api
      - name: Build Web image
        run: docker compose -f infrastructure/docker/docker-compose.prod.yml build web
```
This job ensures the Dockerfiles produce a successful image in CI.

---

## 7. Post‑Deploy Checklist

- [ ] Verify TLS certificates are renewed (set up a cron job for `certbot renew`).
- [ ] Monitor logs (`docker logs -f prod_api`, `docker logs -f prod_web`).
- [ ] Enable alerts for health‑check failures (e.g., via UptimeRobot hitting `/health`).
- [ ] Run the full E2E suite against the live URL (`npm run test:e2e`).
- [ ] Back‑up PostgreSQL nightly (`pg_dump` to a secure bucket).
- [ ] Ensure the Cloudflare R2 bucket permissions follow **Phase 8** rules (no public keys).

---

## 8. References
- Phase 31 implementation plan – see `phase_31_implementation_plan.md`.
- Dockerfiles – `dockerfiles/api.Dockerfile` and `dockerfiles/web.Dockerfile`.
- Production compose – `infrastructure/docker/docker-compose.prod.yml`.
- PM2 config – `pm2/ecosystem.config.cjs`.
- Security hardening – Phase 26 documentation.

**You are now ready to launch the Photography‑SaaS platform in production.**
