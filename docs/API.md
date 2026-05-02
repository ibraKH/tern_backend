# TERN Backend API Reference

Version: 1.0.0

---

## 1. Overview

The TERN backend is a Node.js/TypeScript/Express REST + WebSocket API for a collaborative ecological State & Transition Model (STM) creator.

| Environment | Base URL |
|-------------|----------|
| Local       | `http://localhost:3000` |
| Production  | `https://hammerhead-app-t8l9y.ondigitalocean.app` |

**Interactive API docs:**
- Swagger UI: `GET /docs`
- OpenAPI JSON: `GET /openapi.json`

---

## 2. Authentication Flow

The API uses JWT Bearer tokens. Follow these steps to authenticate:

### Step 1 — Register

```bash
curl -X POST http://localhost:3000/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "yourpassword", "name": "Your Name"}'
```

### Step 2 — Verify email

A verification token is sent to your email. Submit it to activate the account:

```bash
curl -X POST http://localhost:3000/auth/verify \
  -H "Content-Type: application/json" \
  -d '{"token": "<token-from-email>"}'
```

### Step 3 — Login

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "yourpassword"}'
```

Response:

```json
{
  "token": "<jwt>",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "Your Name",
    "role": "Editor"
  }
}
```

### Step 4 — Use the token

Pass the JWT on every protected request:

```bash
curl http://localhost:3000/models/all \
  -H "Authorization: Bearer <token>"
```

---

## 3. Endpoints

### Role abbreviations

| Abbreviation | Meaning |
|--------------|---------|
| A | Admin |
| E | Editor |
| V | Viewer |
| — | Public (no auth) |

### Auth (`/auth`)

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| GET | `/auth/health` | None | — | Auth service health check |
| POST | `/auth/signup` | None | — | Register a new user account |
| POST | `/auth/verify` | None | — | Verify email with token from email |
| POST | `/auth/resend-verification` | None | — | Resend email verification token |
| POST | `/auth/login` | None | — | Login and receive JWT + user object |

### Models (`/models`)

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| GET | `/models/health` | Bearer | Any | Models service health check |
| GET | `/models/all` | Bearer | A, E, V | List all models the caller can access |
| GET | `/models/templates` | Bearer | Any | List available model templates |
| GET | `/models/:name` | Bearer | A, E, V + model role | Fetch a single model by name |
| POST | `/models/save` | Bearer | A, E + model editor role | Create or update a model |
| POST | `/models/from-template/:name` | Bearer | A, E | Create a new model from a template |
| PATCH | `/models/:name/template` | Bearer | Owner or A | Toggle/set the template flag on a model |
| DELETE | `/models/:name` | Bearer | A only | Hard-delete a model |
| DELETE | `/models/:name/states/:stateId` | Bearer | A, E + model editor | Delete a state from a model |
| DELETE | `/models/:name/transitions/:transitionId` | Bearer | A, E + model editor | Delete a transition from a model |
| GET | `/models/:name/review-lock` | Bearer | A, E, V | Get the review-lock status of a model |
| POST | `/models/:name/review-lock` | Bearer | A only | Acquire the review lock on a model |
| DELETE | `/models/:name/review-lock` | Bearer | A only | Release the review lock on a model |

### Permissions (`/models` — permissions sub-router)

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| GET | `/models/:name/permissions` | Bearer | A only | List all per-model permission grants |
| PUT | `/models/:name/permissions/:email` | Bearer | A only | Grant or update a user's model-level role |
| DELETE | `/models/:name/permissions/:email` | Bearer | A only | Revoke a user's model-level role |

### Collaboration (`/collab`)

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| GET | `/collab/:modelName/activity` | Bearer | Any | Get activity log for a model |
| GET | `/collab/:modelName/comments` | Bearer | Any | List comments on a model |
| POST | `/collab/:modelName/comments` | Bearer | Any | Add a comment to a model |
| PATCH | `/collab/:modelName/comments/:id/resolve` | Bearer | Author or A | Mark a comment as resolved |
| DELETE | `/collab/:modelName/comments/:id` | Bearer | Author or A | Delete a comment |
| GET | `/collab/:modelName/milestones` | Bearer | Any | List milestones for a model |
| POST | `/collab/:modelName/milestones` | Bearer | A, E | Create a new milestone |
| GET | `/collab/:modelName/milestones/:id` | Bearer | Any | Fetch a single milestone |
| DELETE | `/collab/:modelName/milestones/:id` | Bearer | A only | Delete a milestone |
| POST | `/collab/:modelName/milestones/:id/restore` | Bearer | A, E | Restore a model to a milestone snapshot |

### Locks (`/models`)

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| POST | `/models/:name/lock/acquire` | Bearer | Any | Acquire an edit lock on a model |
| POST | `/models/:name/lock/renew` | Bearer | Any | Renew an existing edit lock |
| POST | `/models/:name/lock/release` | Bearer | Any | Release an edit lock |
| GET | `/models/:name/lock` | Bearer | Any | Get current lock state of a model |

### Drivers (`/drivers`)

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| GET | `/drivers/search` | Bearer | A, E, V | Search drivers; query params: `?q=string&limit=int` |
| GET | `/drivers/:id/sub-drivers` | Bearer | A, E, V | List sub-drivers for a given driver |

### Notifications (`/notifications`)

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| GET | `/notifications/mentions` | Bearer | Any | Get unread mention notifications for the caller |
| PATCH | `/notifications/mentions/read` | Bearer | Any | Mark mention notifications as read |

### Admin (`/api/admin`)

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| GET | `/api/admin/stats` | Bearer | A only | Aggregate platform stats (users, models, active sessions) |
| GET | `/api/admin/users` | Bearer | A only | Paginated user list; query: `?page=&limit=&role=&search=` |
| PATCH | `/api/admin/users/:id/role` | Bearer | A only | Change a user's global role |
| DELETE | `/api/admin/users/:id/sessions` | Bearer | A only | Invalidate all sessions for a user |
| DELETE | `/api/admin/users/:id` | Bearer | A only | Hard-delete a user account |
| GET | `/api/admin/audit-log` | Bearer | A only | Paginated audit log of admin actions |

---

## 4. Error Response Format

All errors follow a standard envelope returned by `AppError` subclasses:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable description of what went wrong.",
    "details": {}
  }
}
```

The `details` field is optional and may contain field-level validation errors or other structured context.

### Common error codes

| Code | HTTP Status | Meaning |
|------|-------------|---------|
| `VALIDATION_ERROR` | 400 | Request body or query params failed validation |
| `AUTH_INVALID_CREDENTIALS` | 401 | Email/password mismatch |
| `AUTH_UNVERIFIED` | 403 | Account exists but email has not been verified |
| `AUTH_TOKEN_INVALID` | 401 | JWT is malformed or signature is invalid |
| `AUTH_TOKEN_EXPIRED` | 401 | JWT has expired |
| `RESOURCE_CONFLICT` | 409 | Resource already exists (e.g. duplicate model name) |
| `RESOURCE_NOT_FOUND` | 404 | Requested resource does not exist |
| `FORBIDDEN` | 403 | Caller lacks the required role or permission |

---

## 5. Rate Limiting

Rate limits are enforced per IP address using sliding-window counters.

| Route(s) | Limit | Window |
|----------|-------|--------|
| `POST /auth/signup` | 5 requests | 15 minutes |
| `POST /auth/login` | 10 requests | 15 minutes |
| `POST /auth/resend-verification` | 3 requests | 15 minutes |
| `GET /models/*` (read) | 100 requests | 1 minute |
| `POST /models/*`, `DELETE /models/*` (write) | 30 requests | 1 minute |
| `GET /drivers/*` | 60 requests | 1 minute |
| `/api/admin/*` | 60 requests | 1 minute |

When a limit is exceeded the server responds with HTTP `429 Too Many Requests`.

---

## 6. WebSocket

The TERN backend exposes a Socket.IO server for real-time collaboration events (cursor positions, live edits, presence, notifications).

Full event documentation is in [docs/WEBSOCKET.md](./WEBSOCKET.md).

**Connection URL:** `ws://localhost:3000` (local) / `wss://hammerhead-app-t8l9y.ondigitalocean.app` (production)

**Authentication:** Pass the JWT in the Socket.IO handshake query:

```js
import { io } from "socket.io-client";

const socket = io("ws://localhost:3000", {
  auth: { token: "<jwt>" }
});
```

The server validates the token during the `connection` event and will disconnect unauthenticated sockets.

---

## 7. Environment Setup

### Environment variables

Copy `.env.example` and fill in the values:

```bash
cp .env.example .env
```

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret key used to sign JWTs |
| `PORT` | HTTP server port (default `3000`) |
| `NODE_ENV` | `development` or `production` |
| `SMTP_HOST` | SMTP server hostname for email |
| `SMTP_PORT` | SMTP server port |
| `SMTP_USER` | SMTP username / address |
| `SMTP_PASS` | SMTP password |
| `FRONTEND_URL` | Allowed CORS origin (e.g. `http://localhost:5173`) |

### Quickstart

```bash
# Install dependencies
npm install

# Run all pending database migrations
npm run migrate:up

# Start the development server with hot-reload
npm run dev
```

The server will be available at `http://localhost:3000`. Swagger UI is at `http://localhost:3000/docs`.
