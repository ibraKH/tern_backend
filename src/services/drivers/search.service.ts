import pool from '../../config/database';
import type { DriverResult, SubDriverResult } from '../../types/drivers.types';

/**
 * Case-insensitive partial match on the driver name column.
 * Used by the transition panel autocomplete to let users search drivers by typing.
 */
export async function searchDrivers(query: string, limit: number = 20): Promise<DriverResult[]> {
  const { rows } = await pool.query<DriverResult>(
    `SELECT id, driver AS name, description, driver_group
     FROM drivers
     WHERE driver ILIKE $1
     ORDER BY driver
     LIMIT $2`,
    [`%${query}%`, limit],
  );
  return rows;
}

/**
 * Returns all sub-drivers for a given parent driver.
 * Throws a 404-tagged error when the parent driver ID does not exist in the DB.
 */
export async function getSubDrivers(driverId: number): Promise<SubDriverResult[]> {
  const parentCheck = await pool.query('SELECT id FROM drivers WHERE id = $1', [driverId]);
  if (parentCheck.rows.length === 0) {
    throw Object.assign(new Error('Driver not found'), { status: 404 });
  }

  const { rows } = await pool.query<SubDriverResult>(
    `SELECT id, driver_type, driver_description, management_driver_id
     FROM sub_drivers
     WHERE management_driver_id = $1
     ORDER BY id`,
    [driverId],
  );
  return rows;
}
