# TERN Backend

A robust backend platform for creating, managing, and collaboratively editing **State Transition Models (STMs)** used in ecosystem assessment and biodiversity management. Built with TypeScript, Express, PostgreSQL, and Socket.IO for real-time collaboration.

---

## What is TERN Backend?

TERN Backend powers a web application where ecologists, researchers, and land managers work together on State Transition Models , structured representations of how ecosystems change over time through different states, transitions, and driving factors. The backend handles everything from user authentication to real-time multi-user editing with conflict-free collaboration.

---

## Features

### Ecosystem Model Management
- **Full model lifecycle** Create, read, update, and delete State Transition Models with rich nested data including ecosystem states, transitions, causal chains, and environmental drivers.
- **VAST classification** Integrated support for Australia's Vegetation Assets, States and Transitions (VAST) framework with six vegetation condition classes.
- **Ecosystem attributes** Track measurable state attributes like canopy height, species richness, native dominance, and ground cover with units.
- **Transition modelling** Define state transitions with timeframes, likelihood estimates, transition deltas, and detailed causal chains linking management interventions, abiotic factors, biotic processes, and hazards.
- **Contributor tracking** Manage contributing experts with roles (Author, Reviewer) linked to model metadata.

### Real-Time Collaborative Editing
- **Live presence** See who's currently viewing or editing a model in real time, with color-coded user cursors and viewport tracking.
- **Exclusive editing locks** TTL-based locking system prevents conflicting edits. Users acquire locks on specific nodes, edges, or entire models with automatic expiry and cleanup.
- **Live field patches** Changes broadcast instantly to all users in a model room via WebSockets.
- **Activity feed** Real-time audit trail of all model changes (saves, deletions, comments, milestones) visible to all collaborators.

### Comments and Discussion
- **Contextual comments** Leave comments on specific states, transitions, or the model as a whole.
- **@mentions** — Tag collaborators by email to draw their attention.
- **Comment resolution** Mark discussion threads as resolved when issues are addressed.

### Version Snapshots (Milestones)
- **Named snapshots** Save the full state of a model at any point as a milestone with a descriptive label.
- **Restore from milestone** Roll back a model to any previous snapshot with a single action.
- **Snapshot history** Browse and compare milestones to track how a model has evolved.

### Authentication and Access Control
- **JWT authentication** Secure token-based authentication for all API and WebSocket connections.
- **Role-based permissions** Three-tier access system:
  - **Admin** Full access: create, edit, delete models and milestones, manage comments.
  - **Editor** Create and edit models, add milestones, and comment.
  - **Viewer** Read-only access to models and comments.
- **Bcrypt password hashing** Passwords secured with salted hashing and pepper.

### Security and Reliability
- **Rate limiting** Configurable throttling on authentication and model endpoints to prevent abuse.
- **Input validation** Request validation with Zod schemas enforcing email format, password strength, and data integrity.
- **Security headers** Helmet.js provides CSP, HSTS, and other protective HTTP headers.
- **CORS configuration** Whitelisted origin control for frontend applications.
- **Request tracing** Every request tagged with a unique ID for debugging and monitoring.

### API Documentation
- **Swagger/OpenAPI** Interactive API documentation auto-generated from route annotations, available at `/docs`.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20+ |
| Language | TypeScript 5.9 |
| Framework | Express 5 |
| Database | PostgreSQL 16 with PostGIS |
| Real-Time | Socket.IO 4.8 |
| Auth | JWT + bcrypt |
| Validation | Zod |
| Migrations | node-pg-migrate |
| Testing | Jest + Supertest |
| Containerization | Docker + Docker Compose |
| CI/CD | GitHub Actions |

---

## Project Structure

```
src/
├── config/          # Database connection and environment config
├── routes/          # REST API route definitions
├── services/        # Business logic for models, auth, and collaboration
├── middlewares/      # Auth, role-based access, rate limiting, error handling
├── collab/          # Socket.IO handlers, room management, lock cleanup
├── validation/      # Zod request schemas
├── types/           # TypeScript type definitions
├── utils/           # JWT and hashing utilities
└── swagger/         # OpenAPI spec generation
migrations/          # PostgreSQL schema migrations
tests/
├── unit/            # Service and utility unit tests
└── integration/     # API route and Socket.IO integration tests
```

---

## Getting Started

### Prerequisites
- Node.js 20+
- PostgreSQL 16 with PostGIS (local) **or** Docker + Docker Compose (recommended)

### Install
```bash
npm install
```

### Environment

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

Every variable the app reads is documented in `.env.example`. The table below is the quick reference:

| Variable | Required | Example | Description |
|---|---|---|---|
| `PORT` | Optional | `3000` | Server port (defaults to 3000) |
| `NODE_ENV` | Required | `development` | `development`, `production`, or `test` |
| `DATABASE_URL` | Required | `postgres://user:pass@localhost:5432/tern_db` | Full PostgreSQL connection string |
| `PG_HOST` | Dev/Docker | `localhost` | Used by migrations and docker-compose |
| `PG_PORT` | Dev/Docker | `5432` | PostgreSQL port |
| `PG_USER` | Dev/Docker | `postgres` | PostgreSQL username |
| `PG_PASSWORD` | Dev/Docker | `changeme` | PostgreSQL password |
| `PG_DB` | Dev/Docker | `tern` | Database name |
| `JWT_SECRET` | Required | *(32+ random chars)* | Signs all JWT tokens — changing this invalidates existing tokens |
| `JWT_EXPIRES` | Required | `1d` | Token lifetime (`1d`, `2h`, `30m`, …) |
| `JWT_ISSUER` | Optional | `tern-backend` | JWT `iss` claim |
| `JWT_AUDIENCE` | Optional | `tern-api` | JWT `aud` claim |
| `BCRYPT_SALT_ROUNDS` | Required | `12` | bcrypt cost (12 for prod, 4 for fast tests) |
| `BCRYPT_PEPPER` | Required | *(32+ random chars)* | Prepended to passwords before hashing — changing this invalidates existing hashes |
| `FRONTEND_URL` | Required | `http://localhost:5173` | Used for CORS and 404 redirects |
| `PRODUCTION_URL` | Optional | `https://your-app.ondigitalocean.app` | Production backend URL for Swagger server list |
| `GMAIL_USER` | Prod-required | `noreply@example.com` | Gmail address for verification emails |
| `GMAIL_APP_PASSWORD` | Prod-required | *(Google App Password)* | Gmail App Password — generate at **Google Account → Security → App Passwords** |

> `GMAIL_USER` and `GMAIL_APP_PASSWORD` are only enforced when `NODE_ENV=production`. Email is skipped silently in development.

### Database Setup

Migrations live in `migrations/` and must be applied before the server will start against a fresh database.

```bash
npm run migrate:up       # apply all pending migrations (dev)
npm run migrate:up:prod  # apply against production DATABASE_URL
npm run migrate:status   # check what's applied
npm run migrate:down     # roll back the most recent migration
```

Three default STM templates (`Woodlands`, `Grasslands`, `Shrublands`) are seeded automatically by the migrations. See [`docs/MIGRATIONS.md`](docs/MIGRATIONS.md) for the full migration history and rollback warnings.

### Run Locally
```bash
npm run dev       # Development with hot reload
npm run build     # Compile TypeScript
npm start         # Production (requires npm run build first)
```

### Run with Docker
```bash
docker compose up -d --build
```

### API Documentation

- **Swagger UI** — `GET /docs` (interactive, auto-generated from route annotations)
- **OpenAPI JSON** — `GET /openapi.json`
- **Postman collection** — [`docs/postman/`](docs/postman/) contains a full collection of 81 requests plus local and production environment files. See [`docs/postman/README.md`](docs/postman/README.md) for import instructions.

Additional references: [`docs/API.md`](docs/API.md) (route reference), [`docs/WEBSOCKET.md`](docs/WEBSOCKET.md) (WebSocket events).

### Run Tests
```bash
npm test              # unit + integration tests (Jest)
npm run test:api      # Newman end-to-end API tests (requires running server)
```

---

## Related Repositories

- Frontend: [FRONTEND_REPO_URL]
- Handover documentation (Confluence): [CONFLUENCE_URL]

---

## License

[MIT License](LICENSE) — Copyright 2026 Ibrahim Alharthi and the TERN development team.

---

## Taking This Over

A quick-start guide for the next maintainer.

### Run locally

```bash
git clone <this-repo> && cd tern_backend
npm install
cp .env.example .env      # fill in DATABASE_URL, PG_*, JWT_SECRET, BCRYPT_PEPPER, FRONTEND_URL
npm run migrate:up         # apply all DB migrations
npm run dev                # server at http://localhost:3000
```

The Swagger UI at `http://localhost:3000/docs` maps every endpoint interactively.

### Deploy

The backend runs on **DigitalOcean App Platform** connected to a DigitalOcean Managed PostgreSQL database. Deployments are automatic on push to `main`. All secrets are set as environment variables in the App Platform dashboard — never in the repo.

To deploy to a new app:
1. Create an App Platform app pointing at this repo. Build command: `npm run build`. Run command: `node dist/index.js`.
2. Attach a managed PostgreSQL database; copy the `DATABASE_URL` it provides into the app's env vars.
3. Set all required environment variables in the App Platform dashboard.
4. Push to `main` — the platform builds and deploys automatically.
5. Run migrations: `npm run migrate:up:prod`.

### Add a new endpoint

1. Create a route file in `src/routes/` (copy an existing one as a template).
2. Mount it in `src/app.ts` with `requireAuth` / `requireAdmin` middleware as needed.
3. Add a Zod validation schema in `src/validation/`.
4. Write an integration test in `tests/integration/`.
5. Add JSDoc `@swagger` annotations — the spec regenerates on next server start.

### Key config locations

| What | Where |
|---|---|
| Env vars (local) | `.env` |
| Env vars (production) | DigitalOcean App Platform dashboard |
| Database pool | `src/config/database.ts` |
| Env validation | `src/config/env.ts` |
| CORS origins | `src/app.ts` — `allowedOrigins` set |
| Rate limits | `src/middlewares/rateLimit.ts` |
| Role constants | `src/constants/roles.ts` |
| Migrations | `migrations/` |

### Contact and IP

This project was developed as a TechLauncher graduation project at the **Australian National University (ANU)**. Project IP belongs to ANU under the TechLauncher program. For contacts, see the Confluence handover page at `[CONFLUENCE_URL]`.
