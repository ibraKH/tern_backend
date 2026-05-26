# TERN API — Postman Collection

This directory contains the Postman collection and environment files for the TERN backend API.

## Files

| File | Description |
|---|---|
| `TERN_API.collection.json` | Full collection — 81 requests covering all endpoints |
| `local.environment.json` | Environment variables for local development (`http://localhost:3000`) |
| `production.environment.json` | Environment variables for production (fill in credentials before use) |

## How to Import

1. Open Postman.
2. Click **Import** → **Upload Files**.
3. Select `TERN_API.collection.json`.
4. Repeat to import `local.environment.json` (or `production.environment.json` for prod testing).
5. Select the imported environment in the environment dropdown in the top-right corner.

## Running the Collection

**Run in Postman:** Open the `TERN` collection, select the environment, and run the `Auth` folder first — it auto-saves `accessToken` to the environment so subsequent requests authenticate automatically.

**Run via Newman (CLI):**

```bash
# Against local server
npm run test:api

# Against production
npm run test:api:prod
```

Results are saved to `results/newman.xml` (JUnit format).

## Filling in Production Credentials

`production.environment.json` uses placeholder values (`YOUR_ADMIN_EMAIL`, `YOUR_ADMIN_PASSWORD`, etc.). Replace these with real values before running against production. Do **not** commit real credentials to this file.
