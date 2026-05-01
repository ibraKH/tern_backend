import { z } from 'zod';
import pool from '../../config/database';
import { AppError, ValidationError } from '../../errors'; 

const templateSchema = z.object({
  stm_name: z.string().min(1, 'Model name is required'),
  version: z.string().optional(),
  release_date: z.string().optional(),
  authorised_by: z.string().optional(),
  region: z.string().optional(),
  region_id: z.number().optional(),
  climate: z.string().optional(),
  ecosystem_type: z.string().optional(),
  aus_eco_archetype_code: z.string().optional(),
  aus_eco_archetype_name: z.string().optional(),
  aus_eco_umbrella_code: z.string().optional(),
  peer_reviewed: z.boolean().optional(),
  no_peer_reviewers: z.number().optional(),
});

export async function uploadTemplateModel(buffer: Buffer): Promise<void> {
  const client = await pool.connect();
  let transactionStarted = false;

  try {

    let content;
    try {
      content = JSON.parse(buffer.toString('utf-8'));
    } catch (e) {
      throw new ValidationError('Invalid JSON format');
    }

    const parsedData = templateSchema.parse(content);

    await client.query('BEGIN');
    transactionStarted = true;

    await client.query(
      `INSERT INTO models (stm_name, version, release_date, is_template)
       VALUES ($1, $2, $3, true)`,
      [
        parsedData.stm_name, 
        parsedData.version || '1.0.0', 
        parsedData.release_date || new Date().toISOString()
      ]
    );

    await client.query('COMMIT');
  } catch (error) {

    if (transactionStarted) {
      await client.query('ROLLBACK');
    }

    if (error instanceof z.ZodError) {
    throw new ValidationError({
    message: `Validation failed: ${error.issues[0].message}`,
    issues: error.issues
  });
}

    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(
      500, 
      "DB_ERROR", 
      error instanceof Error ? error.message : "Internal server error"
    );
  } finally {
    client.release();
  }
}