import pool from "../config/database";
import { hash, verify } from "../utils/hash";
import type { Signup, Login, User } from "../types/auth.types";

const toUser = (row: any): User => ({
  id: row.id, email: row.email, password_hash: row.password_hash,
  role: row.role, contributor_id: row.contributor_id
});

export async function createUser(dto: Signup): Promise<User> {
  const client = await pool.connect();
  try {
    const pw = await hash(dto.password);
    const { rows } = await client.query(
      `INSERT INTO auth_users (email, password_hash, role)
       VALUES ($1,$2,COALESCE($3,'author')) RETURNING *`,
      [dto.email.toLowerCase(), pw, dto.role]
    );
    return toUser(rows[0]);
  } finally { client.release(); }
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const { rows } = await pool.query(`SELECT * FROM auth_users WHERE email=$1`, [email.toLowerCase()]);
  return rows[0] ? toUser(rows[0]) : null;
}

export async function authenticate(dto: Login): Promise<User | null> {
  const user = await getUserByEmail(dto.email);
  if (!user) return null;
  const ok = await verify(dto.password, user.password_hash);
  return ok ? user : null;
}