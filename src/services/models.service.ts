import pool from '../config/database';


// Get all model names
export async function getAllModels() {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT stm_name FROM stmmodel ORDER BY stm_name`
    );
    // Only return the names as an array of strings
    return result.rows.map(r => r.stm_name);
  } finally {
    client.release();
  }
}

// Get model details by name, including states and transitions
export async function getModelByName(name: string) {
  const client = await pool.connect();
  try {
    const modelResult = await client.query(
      `SELECT stm_name, version, release_date, authorised_by, climate
       FROM stmmodel
       WHERE stm_name = $1`,
      [name]
    );

    if (modelResult.rows.length === 0) {
      return null;
    }
    const model = modelResult.rows[0];

    const statesResult = await client.query(
      `SELECT id, state_name, ellictation_type
       FROM states
       WHERE stm_name = $1`,
      [name]
    );

    const transitionsResult = await client.query(
      `SELECT id, start_state_id, end_state_id, transition_delta
       FROM transitions
       WHERE stm_name = $1`,
      [name]
    );

    return {
      ...model,
      states: statesResult.rows,
      transitions: transitionsResult.rows,
    };
  } finally {
    client.release();
  }
}
