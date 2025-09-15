import pool from '../config/database';


// 获取所有模型名字
export async function getAllModels() {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT stm_name FROM stmmodel ORDER BY stm_name`
    );
    // 只返回名字数组
    return result.rows.map(r => r.stm_name);
  } finally {
    client.release();
  }
}

// 根据名字获取模型详情
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
