// Load .env so integration tests that use the real DB pool get a valid DATABASE_URL.
// dotenv does not expand shell-style ${VAR} references, so we expand manually.
// Tests always target the dedicated tern_test database.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config();
const _e = process.env;
const _pgDb = _e.PG_DB_TEST ?? `${_e.PG_DB}_test`;
_e.DATABASE_URL = `postgres://${_e.PG_USER}:${_e.PG_PASSWORD}@${_e.PG_HOST}:5432/${_pgDb}`;

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
process.env.JWT_EXPIRES = process.env.JWT_EXPIRES || '1h';
process.env.BCRYPT_SALT_ROUNDS = process.env.BCRYPT_SALT_ROUNDS || '4';
process.env.BCRYPT_PEPPER = process.env.BCRYPT_PEPPER || 'pepper';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';