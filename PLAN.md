# Keel — Build Plan

> Flutter-first, self-hosted BaaS. 2GB RAM target. Multi-project with isolated databases.
> Repo: `github.com/Skndan/keel`
> Monorepo: Turborepo | DB: raw SQL + node-pg-migrate | Storage: Cloudflare R2 | Auth: Custom JWT + OAuth

---

## Architecture

```
┌─────────────┐  ┌──────────────┐  ┌──────────────┐
│  Flutter SDK  │  │  Dashboard    │  │  External     │
│  (Mobile)     │  │  (Vite+React) │  │  Clients      │
└──────┬──────┘  └──────┬───────┘  └──────┬───────┘
       │                │                 │
       └────────────────┼─────────────────┘
                        │
        ┌───────────────▼────────────────┐
        │        Caddy (reverse proxy)     │
        │  /api/* → gateway               │
        │  /ws/*  → realtime              │
        │  /*     → dashboard SPA         │
        └───────────────┬────────────────┘
                        │
              ┌─────────▼──────────────┐
              │     Gateway (Bun)       │
              │  Auth + Storage +       │
              │  Project management     │
              └──┬───┬───┬────────────┘
                 │   │   │
      ┌──────────┘   │   └──────────┐
      ▼               ▼              ▼
┌──────────┐  ┌──────────┐  ┌──────────────────────────┐
│ Realtime │  │  Worker   │  │      PostgreSQL 16        │
│ (Bun WS) │  │(Webhook,  │  │                           │
│pg_notify │  │Scheduler, │  │  keel_master  (accounts,  │
└────┬─────┘  │Audit)     │  │    projects, oauth_states) │
     │        └────┬─────┘  │                           │
     └─────────────┘        │  keel_p_<slug> (per-proj)  │
                            │    user tables, RLS, data  │
                            └──────────────────────────┘

Cloudflare R2 (presigned URLs, direct uploads, no local server)
Google OAuth + GitHub OAuth (external identity)
```

## Key Decisions

| Decision | Choice | Why |
|---|---|---|
| Auth | Custom JWT (Bun + jose + Postgres) | No Keycloak |
| OAuth | Google + GitHub | Two providers, minimal complexity |
| Sessions | JWT-only, stateless | No server-side sessions |
| Token lifetime | Access: 15min, Refresh: 30 days (rotated) | Standard |
| Realtime | pg_notify, no Valkey | Single-node, local pub/sub |
| Database | raw SQL + node-pg-migrate | No ORM |
| Dashboard | Vite + React SPA, served by Caddy | Zero server cost |
| Workers | Single Bun process (Webhook + Scheduler + Audit) | 1 not 3 |
| Storage | Cloudflare R2 | External, free egress |
| Function Runner | Cut to v2 | Too heavy |
| Infra | Docker Compose, Hetzner CX22 (2GB) | |

## Multi-Project Architecture

### Master Database (`keel_master`)
```
accounts          — id, email, name, avatar_url, provider, provider_id, created_at
refresh_tokens    — id, user_id, hashed_token, expires_at, rotated_at
oauth_states      — state, provider, code_verifier, redirect_uri, expires_at
projects          — id, name, slug, account_id, db_name, api_key_hash, created_at
```

### Per-Project Database (`keel_p_<slug>`)
```
# Created on project creation. Contains:
# - User's tables (any schema)
# - pg_notify triggers (auto-added on creation)
# - RLS policies (auto-added on creation)
```

### Project Creation Flow
```
Dashboard → POST /v1/projects (JWT auth)
  → Generate slug from name
  → CREATE DATABASE keel_p_<slug>
  → CREATE USER keel_u_<slug> WITH PASSWORD '<random>'
  → GRANT ALL ON DATABASE keel_p_<slug> TO keel_u_<slug>
  → Generate API key (JWK-keypair per project)
  → Run migration on new DB (pg_notify triggers, RLS base)
  → Store project record in keel_master.projects
  → Return: slug, api_key, connection_string
```

### Gateway Routing
```
POST /v1/project/<slug>/db/query          → JWT auth → connect to keel_p_<slug>
POST /v1/project/<slug>/storage/upload-url → JWT auth → R2 bucket scoped to project
GET  /v1/project/<slug>/storage/download-url
POST /v1/project/<slug>/functions/invoke   → (if added later)
POST /v1/project/<slug>/webhooks
GET  /v1/project/<slug>/realtime           → WebSocket upgrade, scoped to project
```

### API Key Model
- On project creation, a **project-scoped JWT key** is generated
- Flutter SDK connects with: `baseUrl + apiKey`
- Gateway validates project API key → resolves project DB → routes query
- Account JWT is for **dashboard/admin** actions (create project, manage webhooks)
- Project API key is for **client/app** actions (db queries, storage, realtime)

---

## Estimated RAM Budget

| Process | Idle | Peak |
|---|---|---|
| Postgres 16 (multi-db) | ~100MB | ~250MB |
| Gateway (Bun) | ~50MB | ~120MB |
| Realtime (Bun WS) | ~40MB | ~90MB |
| Worker (Bun) | ~40MB | ~90MB |
| Caddy | ~10MB | ~20MB |
| **Total** | **~240MB** | **~570MB** |

> Still under 2GB with room for 3–5 small projects on a CX22.

---

## Releases

### v0.1 — Foundation
Monorepo + Master DB + Auth + Gateway + Project provisioning
- Scaffold + Docker Compose + Caddy
- Master database schema: accounts, refresh_tokens, oauth_states, projects
- OAuth (Google + GitHub) via custom JWT
- Project creation API (CREATE DATABASE, schema migration, API key gen)
- Gateway routes: auth, project CRUD, project-scoped db query, storage URLs, health

### v0.2 — Data Layer
Realtime + Consolidated Worker
- Realtime: Bun WS, pg_notify LISTEN, per-project subscription management
- Worker: One Bun process — webhook (pgmq, SKIP LOCKED), scheduler (cron), audit

### v0.3 — Frontend
Dashboard SPA + Flutter SDK
- Vite + React dashboard: OAuth login → project list → create project → table browser → storage browser → webhook manager
- Flutter SDK: KeelClient, OAuth PKCE, Dio interceptor, project API key, realtime streams, storage helpers
- Caddy serving SPA + reverse proxy

---

## Build Order

```
v0.1 → Scaffold + Master DB + Auth + Gateway + Project provisioning
  ↓
v0.2 → Realtime + Worker
  ↓
v0.3 → Dashboard SPA + Flutter SDK
```
