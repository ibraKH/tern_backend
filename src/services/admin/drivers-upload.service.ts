import { parse } from 'csv-parse/sync';
import pool from '../../config/database';
import { AppError, ValidationError } from '../../errors'; 

export async function uploadDriversFromFile(
  buffer: Buffer,
  mimetype: string
): Promise<void> {

  const isCSV = mimetype.includes('csv');
  const isJSON = mimetype.includes('json');

  if (!isCSV && !isJSON) {

    throw new ValidationError('Invalid file type');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (isCSV) {
      const content = buffer.toString('utf-8');
      let records;
      
      try {
        records = parse(content, {
          columns: true,
          skip_empty_lines: true,
          trim: true,
        });
      } catch (e) {
        throw new ValidationError('Failed to parse CSV: invalid format');
      }

      if (!Array.isArray(records)) {
        throw new ValidationError('Malformed CSV file');
      }

      for (const [index, record] of records.entries()) {
        if (!record || typeof record !== 'object') {
          throw new ValidationError(`Malformed CSV at row ${index + 1}`);
        }

        const { name, description, category } = record as any;

        if (!name || !description || !category) {
          throw new ValidationError(`Malformed CSV at row ${index + 1}: missing fields`);
        }

        try {
          await client.query(
            `INSERT INTO drivers (name, description, category)
             VALUES ($1, $2, $3)
             ON CONFLICT (name)
             DO UPDATE SET
               description = EXCLUDED.description,
               category = EXCLUDED.category`,
            [name, description, category]
          );
        } catch (e) {
          throw new ValidationError(`Database error at CSV row ${index + 1}`);
        }
      }
    }

    else if (isJSON) {
      let content;
      try {
        content = JSON.parse(buffer.toString('utf-8'));
      } catch {
        throw new ValidationError('Invalid JSON format');
      }

      if (!Array.isArray(content)) {
        throw new ValidationError('JSON file must be an array');
      }

      for (const driver of content) {
        if (!driver || typeof driver !== 'object') {
          throw new ValidationError('Malformed driver object');
        }

        const { name, description, sub_drivers } = driver as any;

        if (!name || !description) {
          throw new ValidationError(`Malformed driver: missing name or description`);
        }

        if (!Array.isArray(sub_drivers)) {
          throw new ValidationError(`Malformed driver: sub_drivers must be array for ${name}`);
        }

        let result;
        try {
          result = await client.query(
            `INSERT INTO drivers (name, description)
             VALUES ($1, $2)
             ON CONFLICT (name)
             DO UPDATE SET description = EXCLUDED.description
             RETURNING id`,
            [name, description]
          );
        } catch (e) {
          throw new ValidationError(`Database error while inserting driver ${name}`);
        }

        const driverId = result.rows?.[0]?.id;
        if (!driverId) {
          throw new ValidationError(`Failed to get driver id for ${name}`);
        }

        for (const subDriver of sub_drivers) {
          if (!subDriver || typeof subDriver !== 'object') {
            throw new ValidationError(`Malformed sub_driver for ${name}`);
          }

          const { name: subName, description: subDescription } = subDriver;
          if (!subName || !subDescription) {
            throw new ValidationError(`Malformed sub_driver for parent driver ${name}`);
          }

          try {
            await client.query(
              `INSERT INTO sub_drivers (name, description, driver_id)
               VALUES ($1, $2, $3)
               ON CONFLICT (name)
               DO UPDATE SET description = EXCLUDED.description`,
              [subName, subDescription, driverId]
            );
          } catch (e) {
            throw new ValidationError(`Database error while inserting sub_driver ${subName}`);
          }
        }
      }
    }

    await client.query('COMMIT');

  } catch (error) {
    await client.query('ROLLBACK');

    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(500, "DB_ERROR", error instanceof Error ? error.message : "Internal server error during upload");

  } finally {
    client.release();
  }
}