// Here to create a models services to interact with the database.

import pool from '../config/database';
import { BMRGData, StateData, TransitionData } from '../types/types';

export async function saveModel(modelData: BMRGData) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Save main model
    const {
      stm_name,
      version,
      release_date,
      authorised_by,
      contributing_experts,
      region,
      region_id,
      climate,
      ecosystem_type,
      aus_eco_archetype_code,
      aus_eco_archetype_name,
      aus_eco_umbrella_code,
      peer_reviewed,
      no_peer_reviewers,
      states,
      transitions,
      method_alignment
    } = modelData;

    const modelResult = await client.query(
      `INSERT INTO stmmodel (
        stm_name, version, release_date, authorised_by, climate, region_id, region, ecosystem_type,
        aus_eco_archetype_code, aus_eco_archetype_name, aus_eco_umbrella_code, peer_reviewed, no_peer_reviewers
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (stm_name) DO NOTHING
      RETURNING id`,
      [
        stm_name, version, release_date, authorised_by, climate, region_id, region, ecosystem_type,
        aus_eco_archetype_code, aus_eco_archetype_name, aus_eco_umbrella_code, peer_reviewed, no_peer_reviewers
      ]
    );
    const modelId = modelResult.rows[0]?.id;


    // 2. Save states
    for (const state of states) {
      // 2.1 Save vast_state
      let vastStateId = null;
      if (state.vast_state) {
        const vastResult = await client.query(
          `INSERT INTO vast_states (vast_class, vast_name, eks_overstorey_class, eks_understorey_class, eks_substate, link)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [
            state.vast_state.vast_class,
            state.vast_state.vast_name,
            state.vast_state.eks_overstorey_class,
            state.vast_state.eks_understorey_class,
            state.vast_state.eks_substate,
            state.vast_state.link
          ]
        );
        vastStateId = vastResult.rows[0]?.id;
      }

      // 2.2 Save state
      await client.query(
        `INSERT INTO states (
          id, state_name, vast_state_id, condition_upper, condition_lower, eks_condition_estimate, ellictation_type, stm_name
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO NOTHING`,
        [
          state.state_id,
          state.state_name,
          vastStateId,
          state.condition_upper,
          state.condition_lower,
          state.eks_condition_estimate,
          state.elicitation_type,
          stm_name
        ]
      );

      // 2.3 Save state_attributes
      if (state.attributes) {
        await client.query(
          `INSERT INTO state_attributes (state_id, units)
           VALUES ($1, $2)
           ON CONFLICT (state_id) DO NOTHING`,
          [state.state_id, state.attributes.units || null]
        );
      }
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