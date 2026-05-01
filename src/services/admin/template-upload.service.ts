import pool from '../../config/database';
import { validateSTMModel } from '../../validation/validate';

export async function handleTemplateUpload(file: Express.Multer.File) {
  if (!file) {
    throw { status: 400, message: 'No file uploaded' };
  }

  const mimeType = file.mimetype;

  if (mimeType !== 'application/json') {
    throw {
      status: 400,
      message: 'Invalid file type. Only JSON is allowed.',
    };
  }

  const content = file.buffer.toString('utf-8');

  let data;

  try {
    data = JSON.parse(content);
  } catch {
    throw { status: 400, message: 'Invalid JSON format' };
  }

  validateSTMModel(data);

  const { name, ...rest } = data;

  await pool.query(
    `
    INSERT INTO models (name, is_template, data)
    VALUES ($1, $2, $3)
    ON CONFLICT (name)
    DO UPDATE SET
      is_template = EXCLUDED.is_template,
      data = EXCLUDED.data
    `,
    [name, true, rest]
  );

  return { message: 'Template uploaded successfully' };
}