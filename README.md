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
- Node.js 18+
- PostgreSQL (local) **or** Docker + Docker Compose

### Install
```bash
npm install
```

### Environment
Create a `.env` file in the project root:
```env
PORT=3000
NODE_ENV=development
JWT_SECRET=your_secret_key
JWT_EXPIRES=1d
BCRYPT_SALT_ROUNDS=12
BCRYPT_PEPPER=your_pepper
DATABASE_URL=postgres://user:password@localhost:5432/tern_db
```

### Run Locally
```bash
npm run dev       # Development with hot reload
npm run build     # Compile TypeScript
npm start         # Production
```

### Run with Docker
```bash
docker compose up -d --build
```

### Run Tests
```bash
npm test
```

---

## License

This project is part of an academic graduation project for ecosystem model management.
