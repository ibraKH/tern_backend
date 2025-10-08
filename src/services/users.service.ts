import type { Contributor } from "../types/models.types";
import pool from "../config/database";

// Get all contributors
export async function getAllContributors(): Promise<Contributor[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(`SELECT * FROM contributors`);
    return result.rows;
  } finally {
    client.release();
  }
}