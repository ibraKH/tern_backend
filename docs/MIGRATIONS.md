# TERN Backend — Database Migration Runbook

---

## 1. Overview

Migrations live in `db/migrations/` and are run with [node-pg-migrate](https://github.com/salsita/node-pg-migrate) (or the equivalent runner configured in this project). They are applied in filename-timestamp order.

### Migration history

| # | Filename | Description |
|---|----------|-------------|
| 1 | `1758438322642_tern-postgresql-migration.mjs` | **Initial schema** — creates `stmmodel`, `states`, `transitions`, `contributors`, `auth_users`, `collab_locks`, `drivers`, and related core tables |
| 2 | `1758600000000_collab-tables.mjs` | **Collaboration tables** — adds `activity_log`, `comments`, `mentions` |
| 3 | `1758700000000_fix-transition-id-unique.mjs` | **Transition uniqueness** — adds unique constraint on `transition_id` per model |
| 4 | `1758800000000_model-permissions.mjs` | **Per-model permissions** — creates `model_permissions` table for per-model role grants |
| 5 | `1758800000000_state-node-positions.mjs` | **Node positions** — adds `position_x` and `position_y` columns to `states` |
| 6 | `1758850000000_email-verification.mjs` | **Email verification** — adds `is_verified` column to `auth_users` and creates `email_verification_tokens` table; backfills all existing users as verified |
| 7 | `1758900000000_add-is-template.mjs` | **Template flag** — adds `is_template` boolean column to `stmmodel` |
| 8 | `1758900000000_admin-tables.mjs` | **Admin tables** — creates `sessions` and `audit_log` tables (⚠ shares timestamp with migration #7 — see Known Issues) |
| 9 | `1759000000000_add-review-lock-columns.mjs` | **Review lock** — adds `is_locked`, `locked_by`, `locked_at`, `lock_reason` columns to `stmmodel` |
| 10 | `1759100000000_seed-default-templates.mjs` | **Default templates** — seeds 3 built-in templates with their original long names |
| 11 | `1759200000000_rename-default-templates.mjs` | **Rename templates** — renames the 3 default templates to `Woodlands`, `Grasslands`, `Shrublands` (shorter names for clean URLs) |

---

## 2. Fresh Database Setup

Use this procedure when setting up a new environment (local development, staging, or a fresh production database).

```bash
# 1. Create your environment file
cp .env.example .env
# Open .env and set DATABASE_URL to point at your PostgreSQL instance

# 2. Run all pending migrations
npm run migrate:up

# 3. Verify all migrations applied cleanly
npm run migrate:status
```

The `migrate:status` output should show every migration in the table above marked as **applied** with no pending entries.

---

## 3. Production Deployment Gate

**Always run migrations before deploying new application code.** The application code assumes the latest schema is present; deploying code before migrating will cause runtime errors.

### Pre-deployment checklist

1. Take a database backup (snapshot or `pg_dump`).
2. Run migrations against production:
   ```bash
   npm run migrate:up:prod
   ```
3. Confirm clean output — no errors, no unexpected rollbacks.
4. Verify status:
   ```bash
   npm run migrate:status
   ```
   All migrations should show as applied.
5. Deploy the new application version.

---

## 4. Rollback Instructions

The migration runner supports stepping down one migration at a time.

```bash
# Roll back the most recent migration
npm run migrate:down

# To roll back to a specific earlier point, run the command repeatedly
npm run migrate:down   # removes migration N
npm run migrate:down   # removes migration N-1
# ... and so on until you reach the desired state
```

After rolling back, run `npm run migrate:status` to confirm the current applied state.

### Warning — migration #6 (email-verification)

Rolling back migration `1758850000000_email-verification.mjs` drops or nullifies the `is_verified` column on `auth_users`. Because the login path checks this column, **all user logins will fail immediately after the rollback** until the column is restored.

If you need to roll back past this point in production:

1. Put the application into maintenance mode (return 503) before running `migrate:down`.
2. Perform the rollback.
3. Re-deploy a build that does not require the `is_verified` column, or re-apply the migration.

---

## 5. Known Issues

### Migrations #7 and #8 share the same timestamp

Both `1758900000000_add-is-template.mjs` and `1758900000000_admin-tables.mjs` carry the timestamp `1758900000000`. These two migrations operate on entirely different tables (`stmmodel` vs. `sessions`/`audit_log`) so they have no schema dependency on each other. The execution order between them is therefore non-deterministic (runner-dependent) but safe in practice.

**Do not introduce any dependency between these two migrations.** If a future migration needs to reference columns from both, use a new, later timestamp.

### Seed migration is idempotent

Migration `1759100000000_seed-default-templates.mjs` uses `INSERT ... ON CONFLICT DO NOTHING` (or equivalent) when seeding the three default templates. Re-running `migrate:up` after the seed has already been applied will not duplicate the template rows. However, if you manually delete the seeded templates you will need to re-run this migration (or re-insert the rows manually) to restore them.
