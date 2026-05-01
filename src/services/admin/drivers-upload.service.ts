import { parse } from 'csv-parse/sync';
import pool from '../../config/database';
import { validateDriverJSON } from '../../validation/validate';

export async function handleDriverUpload(file: Express.Multer.File) {
  if (!file) {
    throw { status: 400, message: 'No file uploaded' };
  }

  const mimeType = file.mimetype;

  if (!['text/csv', 'application/json'].includes(mimeType)) {
    throw {
      status: 400,
      message: 'Invalid file type. Only CSV and JSON are allowed.',
    };
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

  const records = parse<{ name: string; description: string; category: string }>(content, {
    columns: true,
    skip_empty_lines: true,
  });

  for (const [index, record] of records.entries()) {
    const { name, description, category } = record;

    if (!name || !description || !category) {
      throw {
        status: 400,
        message: `Malformed CSV at row ${index + 1}`,
      };
    }

    await pool.query(
      `
      INSERT INTO drivers (name, description, category)
      VALUES ($1, $2, $3)
      ON CONFLICT (name)
      DO UPDATE SET
        description = EXCLUDED.description,
        category = EXCLUDED.category
      `,
      [name, description, category]
    );
  }

  return { message: 'Drivers uploaded successfully' };
}

/* ─────────────────────────────────────────────
 * JSON UPLOAD (nested drivers + sub-drivers)
 * ───────────────────────────────────────────── */
async function handleJSONUpload(buffer: Buffer) {
  const content = buffer.toString('utf-8');

  let data;

  try {
    data = JSON.parse(content);
  } catch {
    throw { status: 400, message: 'Invalid JSON format' };
  }

  validateDriverJSON(data);

  for (const driver of data) {
    const { name, description, sub_drivers } = driver;

    // upsert driver
    const driverResult = await pool.query(
      `
      INSERT INTO drivers (name, description)
      VALUES ($1, $2)
      ON CONFLICT (name)
      DO UPDATE SET description = EXCLUDED.description
      RETURNING id
      `,
      [name, description]
    );

    const driverId = driverResult.rows[0].id;

    // sub drivers
    for (const subDriver of sub_drivers || []) {
      const {
        name: subName,
        description: subDescription,
      } = subDriver;

      await pool.query(
        `
        INSERT INTO sub_drivers (name, description, driver_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (name)
        DO UPDATE SET
          description = EXCLUDED.description,
          driver_id = EXCLUDED.driver_id
        `,
        [subName, subDescription, driverId]
      );
    }
  }

  return { message: 'Drivers uploaded successfully' };
}