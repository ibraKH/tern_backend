// Here to create a models services to interact with the database.

import pool from '../config/database';

export async function saveModel(modelData: any) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Save main model
    const {
      stm_name,
      version,
      release_date,
      authorised_by,
      climate,
      states,
      transitions
    } = modelData;

    const modelResult = await client.query(
      `INSERT INTO stmmodel (stm_name, version, release_date, authorised_by, climate)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [stm_name, version, release_date, authorised_by, climate]
    );
    const modelId = modelResult.rows[0].id;

    // Save states
    for (const state of states) {
      await client.query(
        `INSERT INTO states (id, state_name, ellictation_type)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO NOTHING`,
        [state.state_id, state.state_name, state.ellictation_type || null]
      );
    }

    // Save transitions
    for (const transition of transitions) {
      await client.query(
        `INSERT INTO transitions (id, transition_delta)
         VALUES ($1, $2)
         ON CONFLICT (id) DO NOTHING`,
        [transition.id, transition.transition_delta || null]
      );
    }

    await client.query('COMMIT');
    return { modelId };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}