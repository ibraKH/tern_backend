import pool from '../../config/database';
import type { BMRGData } from '../../types/models.types';
import { AppError } from '../../errors';
import { ZodError } from 'zod';
import { validateSTMModel } from '../../validation/validate';
import { saveModel } from '../models/save.service';

export async function handleTemplateUpload(file?: Express.Multer.File) {
  if (!file) {
    throw new AppError(400, 'VALIDATION_ERROR', 'No file uploaded');
  }

  const mimeType = file.mimetype;

  if (mimeType !== 'application/json') {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid file type. Only JSON is allowed.');
  }

  const content = file.buffer.toString('utf-8');

  let data;

  try {
    data = JSON.parse(content);
  } catch {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid JSON format');
  }

  let parsed: BMRGData & { name?: string };
  try {
    parsed = validateSTMModel(data) as unknown as BMRGData & { name?: string };
  } catch (err: unknown) {
    if (err instanceof ZodError) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid STM model JSON payload', err.issues);
    }
    throw err;
  }

  const stmName = (typeof (parsed as any).stm_name === 'string' ? (parsed as any).stm_name : (parsed as any).name)?.trim();
  if (!stmName) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Model name is required (stm_name or name)');
  }

  // Prevent overwriting an arbitrary model by trusting an incoming `id`.
  // We upsert by stm_name (existing id lookup) and ignore any provided id.
  const existing = await pool.query<{ id: number }>(
    'SELECT id FROM stmmodel WHERE stm_name = $1 LIMIT 1',
    [stmName]
  );

  const modelData: BMRGData = {
    ...(parsed as unknown as BMRGData),
    stm_name: stmName,
  };
  delete (modelData as unknown as { id?: unknown }).id;

  if (existing.rows.length && typeof existing.rows[0].id === 'number') {
    modelData.id = existing.rows[0].id;
  }

  await saveModel(modelData);

  await pool.query(
    'UPDATE stmmodel SET is_template = TRUE WHERE stm_name = $1',
    [stmName]
  );

  return { message: 'Template uploaded successfully' };
}