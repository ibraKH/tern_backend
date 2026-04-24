import crypto from 'crypto';
import pool from "../config/database";
import { hash, verify } from "../utils/hash";
import type { Signup, Login, User } from "../types/auth.types";
import type { PoolClient } from "pg";
import {
  DbError,
  ConflictError,
  AuthUnverifiedError,
  AuthTokenInvalidError,
  AuthTokenExpiredError,
} from "../errors";

interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  role: User["role"];
  contributor_id: number | null;
  is_verified: boolean;
}

interface PostgresError extends Error {
  code?: string;
  detail?: string;
  constraint?: string;
}

const toUser = (row: UserRow): User => ({
  id: row.id,
  email: row.email,
  password_hash: row.password_hash,
  role: row.role,
  contributor_id: row.contributor_id,
  is_verified: row.is_verified,
});

function isPostgresError(err: unknown): err is PostgresError {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as PostgresError).code === "string"
  );
}

async function linkContributorToUserTx(
  client: PoolClient,
  userId: number,
  name: string,
  email: string
): Promise<number> {
  const e = email.trim().toLowerCase();

  const { rows } = await client.query(
    `INSERT INTO contributors (email, name)
     VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE
       SET name = COALESCE(NULLIF(EXCLUDED.name, ''), contributors.name)
     RETURNING id`,
    [e, name?.trim() || ""]
  );
  const contributorId = rows[0].id;

  await client.query(
    `UPDATE auth_users SET contributor_id = $1 WHERE id = $2`,
    [contributorId, userId]
  );

  return contributorId;
}

export async function createUser(dto: Signup): Promise<User> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const e = dto.email.trim().toLowerCase();
    const pw = await hash(dto.password);

    const { rows: uRows } = await client.query(
      `INSERT INTO auth_users (email, password_hash, role)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [e, pw, dto.role]
    );
    const authUserId = uRows[0].id;

    await linkContributorToUserTx(client, authUserId, dto.name ?? "", e);

    const { rows: finalUser } = await client.query(
      `SELECT id, email, password_hash, role, contributor_id, is_verified
       FROM auth_users WHERE id = $1`,
      [authUserId]
    );

    await client.query("COMMIT");
    return toUser(finalUser[0]);
  } catch (err: unknown) {
    await client.query("ROLLBACK");
    if (isPostgresError(err) && err.code === "23505") {
      throw new ConflictError("email already in use", { field: "email" });
    }
    throw new DbError(err instanceof Error ? err.message : String(err));
  } finally {
    client.release();
  }
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const { rows } = await pool.query<UserRow>(
    `SELECT id, email, password_hash, role, contributor_id, is_verified
     FROM auth_users WHERE email = $1`,
    [email.toLowerCase()]
  );
  return rows[0] ? toUser(rows[0]) : null;
}

export async function authenticate(dto: Login): Promise<User | null> {
  const user = await getUserByEmail(dto.email);
  if (!user) return null;
  const ok = await verify(dto.password, user.password_hash);
  if (!ok) return null;
  if (!user.is_verified) throw new AuthUnverifiedError();
  return user;
}

export async function createVerificationToken(userId: number): Promise<string> {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  // replace any existing token for this user
  await pool.query('DELETE FROM email_verification_tokens WHERE user_id = $1', [userId]);
  await pool.query(
    'INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [userId, tokenHash, expiresAt]
  );

  return rawToken;
}

export async function consumeVerificationToken(rawToken: string): Promise<User> {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const { rows } = await pool.query<{ user_id: number; expires_at: Date }>(
    'SELECT user_id, expires_at FROM email_verification_tokens WHERE token_hash = $1',
    [tokenHash]
  );

  if (!rows[0]) throw new AuthTokenInvalidError();

  if (new Date(rows[0].expires_at) < new Date()) {
    await pool.query('DELETE FROM email_verification_tokens WHERE token_hash = $1', [tokenHash]);
    throw new AuthTokenExpiredError();
  }

  const userId = rows[0].user_id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE auth_users SET is_verified = true WHERE id = $1', [userId]);
    await client.query('DELETE FROM email_verification_tokens WHERE token_hash = $1', [tokenHash]);
    const { rows: userRows } = await client.query<UserRow>(
      'SELECT id, email, password_hash, role, contributor_id, is_verified FROM auth_users WHERE id = $1',
      [userId]
    );
    await client.query('COMMIT');
    return toUser(userRows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw new DbError(err instanceof Error ? err.message : String(err));
  } finally {
    client.release();
  }
}
