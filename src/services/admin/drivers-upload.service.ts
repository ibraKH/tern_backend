import pool from "../../config/database";
import { AppError } from "../../errors";
import { z } from "zod";

const driverTypeEnum = z.enum(["biotic", "abiotic", "hazard"]);

type UploadInput = {
  buffer: Buffer;
  mimeType: string;
  originalName: string;
};

type UploadResult = {
  driversUpserted: number;
  subDriversUpserted: number;
};

type CsvRow = {
  name: string;
  description: string | null;
  category: string | null;
  rowNumber: number;
};

function isProbablyCsv(mimeType: string, originalName: string): boolean {
  if (mimeType === "text/csv") return true;
  return originalName.toLowerCase().endsWith(".csv");
}

function isProbablyJson(mimeType: string, originalName: string): boolean {
  if (mimeType === "application/json") return true;
  return originalName.toLowerCase().endsWith(".json");
}

function parseCsvText(text: string): string[][] {
  // Small CSV parser that supports quoted fields and commas/newlines inside quotes.
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        const next = text[i + 1];
        if (next === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (ch === "\n") {
      row.push(field);
      field = "";
      // Trim possible CR
      if (row.length === 1 && row[0] === "" && rows.length === 0) {
        row = [];
        continue;
      }
      rows.push(row.map((c) => c.replace(/\r$/, "")));
      row = [];
      continue;
    }

    field += ch;
  }

  // last field
  row.push(field);
  rows.push(row.map((c) => c.replace(/\r$/, "")));

  // Drop trailing empty last row
  if (rows.length && rows[rows.length - 1].every((c) => c.trim() === "")) {
    rows.pop();
  }

  return rows;
}

function normalizeCell(v: string | undefined): string {
  return (v ?? "").trim();
}

function csvRowsToObjects(rows: string[][]): CsvRow[] {
  if (!rows.length) return [];

  const first = rows[0].map((c) => c.trim().toLowerCase());
  const hasHeader = first.length >= 3 && first[0] === "name" && first[1] === "description" && first[2] === "category";

  const dataRows = hasHeader ? rows.slice(1) : rows;
  const result: CsvRow[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const rowNumber = hasHeader ? i + 2 : i + 1;

    if (r.length < 3) {
      throw new AppError(400, "VALIDATION_ERROR", `Malformed CSV at row ${rowNumber}: expected 3 columns (name, description, category)`);
    }

    const name = normalizeCell(r[0]);
    const description = normalizeCell(r[1]);
    const category = normalizeCell(r[2]);

    if (!name) {
      throw new AppError(400, "VALIDATION_ERROR", `Malformed CSV at row ${rowNumber}: 'name' is required`);
    }

    result.push({
      name,
      description: description ? description : null,
      category: category ? category : null,
      rowNumber,
    });
  }

  return result;
}

const driverJsonSchema = z
  .array(
    z.object({
      name: z.string().min(1),
      description: z.string().optional().nullable(),
      sub_drivers: z
        .array(
          z.object({
            name: z.string().min(1),
            description: z.string().optional().nullable(),
          })
        )
        .optional()
        .default([]),
    })
  )
  .min(1, "Expected a non-empty array");

async function upsertDriverByName(input: { name: string; description: string | null; driver_group: string | null }): Promise<number> {
  const existing = await pool.query<{ id: number }>(`SELECT id FROM drivers WHERE driver = $1 LIMIT 1`, [input.name]);
  if (existing.rows.length) {
    const id = existing.rows[0].id;
    await pool.query(
      `UPDATE drivers SET description = $2, driver_group = $3 WHERE id = $1`,
      [id, input.description, input.driver_group]
    );
    return id;
  }

  const inserted = await pool.query<{ id: number }>(
    `INSERT INTO drivers (driver, description, driver_group) VALUES ($1, $2, $3) RETURNING id`,
    [input.name, input.description, input.driver_group]
  );
  return inserted.rows[0].id;
}

async function upsertSubDriver(input: { management_driver_id: number; driver_type: z.infer<typeof driverTypeEnum>; driver_description: string | null }) {
  const existing = await pool.query<{ id: number }>(
    `SELECT id FROM sub_drivers WHERE management_driver_id = $1 AND driver_type = $2 LIMIT 1`,
    [input.management_driver_id, input.driver_type]
  );

  if (existing.rows.length) {
    await pool.query(`UPDATE sub_drivers SET driver_description = $2 WHERE id = $1`, [existing.rows[0].id, input.driver_description]);
    return;
  }

  await pool.query(
    `INSERT INTO sub_drivers (driver_type, driver_description, management_driver_id) VALUES ($1, $2, $3)`,
    [input.driver_type, input.driver_description, input.management_driver_id]
  );
}

export async function uploadDriverVocabulary(input: UploadInput): Promise<UploadResult> {
  const text = input.buffer.toString("utf8");

  if (isProbablyCsv(input.mimeType, input.originalName)) {
    const rows = parseCsvText(text);
    const parsedRows = csvRowsToObjects(rows);

    let driversUpserted = 0;
    let subDriversUpserted = 0;

    for (const r of parsedRows) {
      // Dual-mode CSV:
      // - If category matches driver_types enum => treat as sub-driver type, attach to driver (name)
      // - Otherwise => treat as driver_group on the driver row
      const category = r.category;
      const maybeType = category ? driverTypeEnum.safeParse(category) : { success: false as const };

      if (maybeType.success) {
        const driverId = await upsertDriverByName({ name: r.name, description: null, driver_group: null });
        driversUpserted++;
        await upsertSubDriver({
          management_driver_id: driverId,
          driver_type: maybeType.data,
          driver_description: r.description,
        });
        subDriversUpserted++;
      } else {
        await upsertDriverByName({ name: r.name, description: r.description, driver_group: category });
        driversUpserted++;
      }
    }

    return { driversUpserted, subDriversUpserted };
  }

  if (isProbablyJson(input.mimeType, input.originalName)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new AppError(400, "VALIDATION_ERROR", `Malformed JSON: ${(e as Error).message}`);
    }

    const result = driverJsonSchema.safeParse(parsed);
    if (!result.success) {
      throw new AppError(400, "VALIDATION_ERROR", "Malformed JSON structure", result.error.flatten());
    }

    let driversUpserted = 0;
    let subDriversUpserted = 0;

    for (let i = 0; i < result.data.length; i++) {
      const d = result.data[i];
      const driverId = await upsertDriverByName({
        name: d.name,
        description: d.description ?? null,
        driver_group: null,
      });
      driversUpserted++;

      for (let j = 0; j < d.sub_drivers.length; j++) {
        const sd = d.sub_drivers[j];
        const typeResult = driverTypeEnum.safeParse(sd.name);
        if (!typeResult.success) {
          throw new AppError(
            400,
            "VALIDATION_ERROR",
            `Malformed JSON at drivers[${i}].sub_drivers[${j}].name: must be one of ${driverTypeEnum.options.join(", ")}`
          );
        }

        await upsertSubDriver({
          management_driver_id: driverId,
          driver_type: typeResult.data,
          driver_description: sd.description ?? null,
        });
        subDriversUpserted++;
      }
    }

    return { driversUpserted, subDriversUpserted };
  }

  throw new AppError(400, "VALIDATION_ERROR", `Unsupported file type: ${input.mimeType}`);
}
