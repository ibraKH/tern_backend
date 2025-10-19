import pool from '../../config/database';


// remove all data related to a model identified by stm_name
export async function removeModelByName(stmName: string): Promise<{ deletedModelId: number }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const modelRes = await client.query(
      `SELECT id, stm_name FROM stmmodel WHERE stm_name = $1`,
      [stmName]
    );
    if (modelRes.rows.length === 0) {
      throw Object.assign(new Error(`Model not found: ${stmName}`), { status: 404 });
    }
    const modelId = modelRes.rows[0].id;

    // states -> transitions -> causal_chain -> method_causal_chain
    const stateIdsRes = await client.query<{ id: number }>(
      `SELECT id FROM states WHERE stm_name = $1`,
      [stmName]
    );
    const stateIds = stateIdsRes.rows.map(r => r.id);

    if (stateIds.length > 0) {
      // find all related transition DB id
      const transIdsRes = await client.query<{ id: number }>(
        `SELECT id FROM transitions
         WHERE start_state_id = ANY($1::int[]) OR end_state_id = ANY($1::int[])`,
        [stateIds]
      );
      const transitionDbIds = transIdsRes.rows.map(r => r.id);

      if (transitionDbIds.length > 0) {
        // method_causal_chain depends on causal_chain
        await client.query(
          `DELETE FROM method_causal_chain
           WHERE causal_chain_id IN (
             SELECT id FROM causal_chain WHERE transition_id = ANY($1::int[])
           )`,
          [transitionDbIds]
        );

        // causal_chain
        await client.query(
          `DELETE FROM causal_chain WHERE transition_id = ANY($1::int[])`,
          [transitionDbIds]
        );

        // transitions
        await client.query(
          `DELETE FROM transitions WHERE id = ANY($1::int[])`,
          [transitionDbIds]
        );
      }

      // states
      await client.query(
        `DELETE FROM states WHERE id = ANY($1::int[])`,
        [stateIds]
      );
    }

    // model_contributions 
    await client.query(
      `DELETE FROM model_contributions WHERE stm_id = $1`,
      [modelId]
    );

    // finally the model itself
    await client.query(
      `DELETE FROM stmmodel WHERE id = $1`,
      [modelId]
    );

    await client.query('COMMIT');
    return { deletedModelId: modelId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}


// delete a state by its DB id, and clean up all related transitions / causal_chain / method_causal_chain
// note: this is a lower-level operation, not exposed via API
// use with caution, as it may leave the model in an inconsistent state if not handled properly
export async function removeState(stmName: string, stateId: number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const s = await client.query(
      `SELECT id FROM states WHERE id = $1 AND stm_name = $2`,
      [stateId, stmName]
    );
    if (s.rows.length === 0) {
      throw Object.assign(new Error(`State not found: ${stateId} in model ${stmName}`), { status: 404 });
    }

    const transIdsRes = await client.query<{ id: number }>(
      `SELECT id FROM transitions WHERE start_state_id = $1 OR end_state_id = $1`,
      [stateId]
    );
    const transitionDbIds = transIdsRes.rows.map(r => r.id);

    if (transitionDbIds.length > 0) {
      await client.query(
        `DELETE FROM method_causal_chain
         WHERE causal_chain_id IN (
           SELECT id FROM causal_chain WHERE transition_id = ANY($1::int[])
         )`,
        [transitionDbIds]
      );

      await client.query(
        `DELETE FROM causal_chain WHERE transition_id = ANY($1::int[])`,
        [transitionDbIds]
      );

      await client.query(
        `DELETE FROM transitions WHERE id = ANY($1::int[])`,
        [transitionDbIds]
      );
    }

    await client.query(
      `DELETE FROM states WHERE id = $1`,
      [stateId]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// delete a transition by its business id (transition_id), and clean up all related causal_chain / method_causal_chain
// note: this is a lower-level operation, not exposed via API
// use with caution, as it may leave the model in an inconsistent state if not handled properly
export async function removeTransitionByBusinessId(stmName: string, transitionId: number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // transitions -> causal_chain -> method_causal_chain
    const t = await client.query<{ id: number }>(
      `SELECT id FROM transitions WHERE stm_name = $1 AND transition_id = $2`,
      [stmName, transitionId]
    );
    if (t.rows.length === 0) {
      throw Object.assign(new Error(`Transition not found: transition_id=${transitionId} in model ${stmName}`), { status: 404 });
    }
    const dbId = t.rows[0].id;

    await client.query(
      `DELETE FROM method_causal_chain
       WHERE causal_chain_id IN (
         SELECT id FROM causal_chain WHERE transition_id = $1
       )`,
      [dbId]
    );

    await client.query(
      `DELETE FROM causal_chain WHERE transition_id = $1`,
      [dbId]
    );

    await client.query(
      `DELETE FROM transitions WHERE id = $1`,
      [dbId]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}




