# ⚓ Keel

> **Multi-project BaaS, 2GB RAM, Flutter-first.** Supabase-compatible, self-hosted on a cheap VPS.

[![GitHub Repo](https://img.shields.io/github/stars/Skndan/keel?style=social)](https://github.com/Skndan/keel)
[![Project Board](https://img.shields.io/badge/board-view-2ea44f)](https://github.com/orgs/Skndan/projects)

---

## What is Keel?

Keel gives every account **isolated Postgres databases** — like Supabase, but without the $25/month price tag. Self-host on a 2GB VPS.

- 🔐 **OAuth Login** — Google + GitHub, JWT-only stateless auth
- 📦 **Multi-Project** — create a project, get an isolated database
- 📡 **Realtime** — WebSocket with Postgres pg_notify, no Redis
- 💾 **Storage** — Cloudflare R2 with presigned URLs
- 🔔 **Webhooks** — per-project webhook subscriptions with retry
- 📱 **Flutter SDK** — first-class mobile client
- 🖥️ **Dashboard** — Vite + React SPA, manage projects and data

---

## 🚀 Quick Start

### Prerequisites

| Tool | Version | Install |
|---|---|---|
| Node.js | >= 20 | [nodejs.org](https://nodejs.org/) |
| pnpm | >= 9 | `npm i -g pnpm` |
| Bun | >= 1.1 | `curl -fsSL https://bun.sh/install \| bash` |
| Docker | >= 24 | [docker.com](https://www.docker.com/) |

### Setup

```bash
git clone https://github.com/Skndan/keel.git
cd keel
pnpm install
cp .env.example .env
```

Edit `.env` and set:
- `POSTGRES_PASSWORD` — database password
- `JWT_SECRET` — random string for signing tokens
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` — dashboard login credentials

> **OAuth and R2 are per-project.** When you create a project in the dashboard, you provide your own Google/GitHub OAuth keys and R2 credentials. Each project is fully isolated — no shared OAuth apps or storage buckets.

### Run (Development)

```bash
# Start infrastructure
docker compose up -d

# Start services with hot-reload
pnpm dev
```

### Run (Production)

```bash
docker compose build
docker compose up -d
```

### Service Endpoints

| Service | URL | Notes |
|---|---|---|
| **Gateway API** | http://localhost:3000 | Main API |
| **Dashboard** | http://localhost:8080 | Admin UI |
| **Health** | http://localhost:3000/v1/health | API status |

---

## 🧪 Testing

```bash
# All tests
pnpm test

# Per-package
pnpm --filter @keel/gateway test
pnpm --filter @keel/realtime test
pnpm --filter @keel/worker test
```

---

## 📁 Architecture

```
Gateway (Bun)  +  Realtime (Bun WS)  +  Worker (Bun)
     |                    |                   |
 OAuth auth         pg_notify LISTEN   Webhook+Scheduler+Audit
 Project CRUD       Subscription mgmt
 DB query proxy
 Storage (R2)
     |
PostgreSQL 16 — keel_master + keel_p_<slug> per project
Caddy — reverse proxy + static SPA server
Cloudflare R2 — file storage (external, zero RAM)
```

---

## 📦 Packages

| Package | Stack | Purpose |
|---|---|---|
| `gateway` | Bun + Fastify | Auth, projects, DB proxy, storage |
| `db` | SQL | Migrations for master + per-project template |
| `realtime` | Bun + WS | pg_notify-based subscriptions |
| `worker` | Bun | Webhooks, scheduler, audit (single process) |
| `dashboard` | Vite + React + Tailwind | Admin SPA with login, project CRUD, table/storage/webhook browsers, settings |
| `flutter-sdk` | Dart | Mobile client SDK |
| `types` | TypeScript | Shared types |

---

## 💾 How Projects Work

```
Login (admin email/pwd) → Dashboard
                              ↓
                  "Create Project" → "my-app"
                  Provide per-project configs:
                  • Google OAuth Client ID + Secret
                  • GitHub OAuth Client ID + Secret
                  • R2 Access Key + Secret + Bucket
                              ↓
                  CREATE DATABASE keel_p_my_app
                  → Isolated schema, RLS, triggers
                  → API key + connection string
                              ↓
                  Flutter SDK connects with:
                  projectSlug + apiKey
                              ↓
                  End users authenticate via project's OAuth
                  POST /v1/project/my-app/db/query
```

---

## 🗺️ Roadmap

| Release | Focus | Status |
|---|---|---|
| **v0.1 — Foundation** | Scaffold, Auth, Projects, Gateway | ✅ Done |
| **v0.2 — Data Layer** | Realtime, Worker | 🚧 In Progress |
| **v0.3 — Frontend** | Dashboard SPA, Flutter SDK | ✅ Done |

---

## 📊 RAM Budget

| Process | Peak RAM |
|---|---|
| Postgres 16 | ~250MB |
| Gateway (Bun) | ~120MB |
| Realtime (Bun) | ~90MB |
| Worker (Bun) | ~90MB |
| Caddy | ~20MB |
| **Total** | **~570MB** |

Runs comfortably on a **Hetzner CX22** (2GB RAM, ₹700/month).

---

## 📄 License

MIT

---

## 🖥️ Deployment (Production)

Keel is deployed on a Hetzner CX22 (2GB RAM) at **keel.skndan.com**.

### Stack
```
Caddy (port 80) → Gateway (port 3000/internal)
                → Realtime (port 3001/internal)
                → Worker (port 3002/internal)
PostgreSQL 16 (port 5432/internal)
```

### Environment
Copy `.env.prod` and fill in:
```bash
cp .env.example .env.prod
# Edit: POSTGRES_PASSWORD, JWT_SECRET, ENCRYPTION_KEY, ADMIN_EMAIL, ADMIN_PASSWORD
```

### Commands
```bash
# Build
docker compose --env-file .env.prod build --no-cache

# Start
docker compose --env-file .env.prod up -d

# Check
curl keel.skndan.com/api/v1/health

# Login
curl -X POST keel.skndan.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"your-password"}'

# Create project
curl -X POST keel.skndan.com/api/v1/projects \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"my-app","google_client_id":"...","google_client_secret":"...","github_client_id":"...","github_client_secret":"...","r2_access_key_id":"...","r2_secret_access_key":"...","r2_bucket":"my-bucket","r2_endpoint":"https://xxx.r2.cloudflarestorage.com"}'
```

### Known Deployment Issues

| Issue | Status | Workaround |
|---|---|---|
| PostgreSQL `pgmq` extension not in default Alpine image | 🟡 Worker can't process webhook/audit queue | Install pgmQ binary or rebuild worker to use `SELECT FOR UPDATE SKIP LOCKED` |
| `CREATE DATABASE` fails in transaction | ✅ Fixed — moved to pre-transaction step | Use `psql -d postgres` for manual DB drops |
| Caddy auto-HTTPS fails if DNS not propagated | ✅ Fixed — HTTP-only until Let's Encrypt validates | Wait for DNS propagation then enable TLS |
| Gateway Docker healthcheck may fail | 🟡 `wget` not in Bun image | External health check passes; cosmetic only |
