import pool from "../config/database";
import { hash, verify } from "../utils/hash";
import type { Signup, Login, User } from "../types/auth.types";
import type { PoolClient } from "pg";

// Shape returned from auth_users queries
interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  role: User["role"];
  contributor_id: number | null;
}

const toUser = (row: UserRow): User => ({
  id: row.id,
  email: row.email,
  password_hash: row.password_hash,
  role: row.role,
  contributor_id: row.contributor_id,
});

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

    // create auth user
    const { rows: uRows } = await client.query(
      `INSERT INTO auth_users (email, password_hash, role)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [e, pw, dto.role]
    );
    const authUserId = uRows[0].id;

    await linkContributorToUserTx(client, authUserId, dto.name ?? "", e);

    const { rows: finalUser } = await client.query(
      `SELECT id, email, password_hash, role, contributor_id
       FROM auth_users WHERE id = $1`,
      [authUserId]
    );

    await client.query("COMMIT");
    return toUser(finalUser[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const { rows } = await pool.query<UserRow>(`SELECT id, email, password_hash, role, contributor_id FROM auth_users WHERE email=$1`, [email.toLowerCase()]);
  return rows[0] ? toUser(rows[0]) : null;
}

export async function authenticate(dto: Login): Promise<User | null> {
  const user = await getUserByEmail(dto.email);
  if (!user) return null;
  const ok = await verify(dto.password, user.password_hash);
  return ok ? user : null;
}