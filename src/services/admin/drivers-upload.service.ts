import { parse } from 'csv-parse/sync';
import pool from '../../config/database';
import { AppError } from '../../errors';
import { ZodError } from 'zod';
import { validateDriverJSON } from '../../validation/validate';

export async function handleDriverUpload(file?: Express.Multer.File) {
  if (!file) {
    throw new AppError(400, 'VALIDATION_ERROR', 'No file uploaded');
  }

  const mimeType = file.mimetype;

  if (!['text/csv', 'application/json'].includes(mimeType)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid file type. Only CSV and JSON are allowed.');
  }

  if (mimeType === 'text/csv') {
    return await handleCSVUpload(file.buffer);
  }

  return await handleJSONUpload(file.buffer);
}

/* ─────────────────────────────────────────────
 * CSV UPLOAD
 * ───────────────────────────────────────────── */
async function handleCSVUpload(buffer: Buffer) {
  const content = buffer.toString('utf-8');

  let records: Array<{ name?: string; description?: string; category?: string }>;
  try {
    records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });
  } catch (err: unknown) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid CSV format', {
      reason: (err as Error)?.message ?? String(err),
    });
  }

  for (const [index, record] of records.entries()) {
    const name = record.name;
    const description = record.description;
    const category = record.category;

    if (!name || !description || !category) {
      // +2 because row 1 is header line when columns: true
      throw new AppError(400, 'VALIDATION_ERROR', `Malformed CSV at row ${index + 2}`);
    }

    await upsertDriver({ name, description, category });
  }

  return { message: 'Drivers uploaded successfully' };
}

/* ─────────────────────────────────────────────
 * JSON UPLOAD (nested drivers + sub-drivers)
 * ───────────────────────────────────────────── */
async function handleJSONUpload(buffer: Buffer) {
  const content = buffer.toString('utf-8');

  let data: unknown;

  try {
    data = JSON.parse(content);
  } catch {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid JSON format');
  }

  let parsed: ReturnType<typeof validateDriverJSON>;
  try {
    parsed = validateDriverJSON(data);
  } catch (err: unknown) {
    if (err instanceof ZodError) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid drivers JSON payload', err.issues);
    }
    throw err;
  }

  for (const driver of parsed) {
    const driverId = await upsertDriver({
      name: driver.name,
      description: driver.description ?? '',
      category: driver.category ?? '',
    });

    for (const subDriver of driver.sub_drivers ?? []) {
      await upsertSubDriver({
        managementDriverId: driverId,
        driverType: subDriver.name,
        driverDescription: subDriver.description ?? null,
      });
    }
  }

  return { message: 'Drivers uploaded successfully' };
}

async function upsertDriver(input: { name: string; description: string; category: string }): Promise<number> {
  const driver = input.name.trim();
  const description = input.description?.trim() || null;
  const driverGroup = input.category?.trim() || null;

  if (!driver) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid driver name');
  }

  // Avoid ON CONFLICT: this works even if there is no UNIQUE constraint.
  const { rows } = await pool.query<{ id: number }>(
    `WITH updated AS (
       UPDATE drivers
          SET description = $2,
              driver_group = $3
        WHERE driver = $1
      RETURNING id
     ),
     inserted AS (
       INSERT INTO drivers (driver, description, driver_group)
       SELECT $1, $2, $3
        WHERE NOT EXISTS (SELECT 1 FROM updated)
          AND NOT EXISTS (SELECT 1 FROM drivers WHERE driver = $1)
      RETURNING id
     )
     SELECT id FROM updated
     UNION ALL
     SELECT id FROM inserted
     LIMIT 1`,
    [driver, description, driverGroup]
  );

  const id = rows[0]?.id;
  if (typeof id !== 'number') {
    throw new AppError(500, 'DB_ERROR', 'Failed to upsert driver');
  }
  return id;
}

async function upsertSubDriver(input: { managementDriverId: number; driverType: string; driverDescription: string | null }): Promise<number> {
  const managementDriverId = input.managementDriverId;
  const driverType = input.driverType.trim();
  const driverDescription = input.driverDescription;

  if (!driverType) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid sub-driver name');
  }

  const { rows } = await pool.query<{ id: number }>(
    `WITH updated AS (
       UPDATE sub_drivers
          SET driver_description = $3
        WHERE management_driver_id = $1
          AND driver_type = $2
      RETURNING id
     ),
     inserted AS (
       INSERT INTO sub_drivers (management_driver_id, driver_type, driver_description)
       SELECT $1, $2, $3
        WHERE NOT EXISTS (SELECT 1 FROM updated)
          AND NOT EXISTS (
            SELECT 1 FROM sub_drivers
             WHERE management_driver_id = $1
               AND driver_type = $2
          )
      RETURNING id
     )
     SELECT id FROM updated
     UNION ALL
     SELECT id FROM inserted
     LIMIT 1`,
    [managementDriverId, driverType, driverDescription]
  );

  const id = rows[0]?.id;
  if (typeof id !== 'number') {
    throw new AppError(500, 'DB_ERROR', 'Failed to upsert sub-driver');
  }
  return id;
}