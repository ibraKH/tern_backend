import pool from '../../config/database';
import type { BMRGData, StateData, TransitionData } from '../../types/models.types';

// Get all model names
export async function getAllModels() {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT stm_name FROM stmmodel ORDER BY stm_name`
    );
    // Only return the names as an array of strings
    return result.rows.map(r => r.stm_name);
  } catch(error){
    throw error;
  } finally {
    client.release();
  }
}

// Get model details by name, including states and transitions
export async function getModelByName(name: string): Promise<BMRGData | null> {
  const client = await pool.connect();
  try {
    // Get model basic info
    const modelRes = await client.query(
      `SELECT id, stm_name, version, release_date, authorised_by,
              region, region_id, ecosystem_type,
              aus_eco_archetype_code, aus_eco_archetype_name,
              aus_eco_umbrella_code, peer_reviewed,
              no_peer_reviewers, climate
       FROM stmmodel
       WHERE stm_name = $1`,
      [name]
    );

    if (modelRes.rows.length === 0) {
      return null;
    }
    const row = modelRes.rows[0];

    // Get contributors
    const contributorsRes = await client.query(
      `SELECT c.id, c.name, c.email, mc.contribution_type
         FROM model_contributions mc
         JOIN contributors c ON c.id = mc.contributor_id
        WHERE mc.stm_id = $1
        ORDER BY c.name`,
      [row.id]
    );

    // Get states + vast_states + state_attributes
    const statesRes = await client.query(
      `SELECT s.id, s.state_name, s.eks_condition_estimate,
              s.condition_lower, s.condition_upper, s.ellictation_type,
              v.vast_class, v.vast_name, v.eks_overstorey_class,
              v.eks_understorey_class, v.eks_substate, v.link
       FROM states s
       LEFT JOIN vast_states v ON s.vast_state_id = v.id
       WHERE s.stm_name = $1`,
      [name]
    );

    const states: StateData[] = [];
    for (const s of statesRes.rows) {
      const attrsRes = await client.query(
        `SELECT attribute_type, value, units
         FROM state_attributes
         WHERE state_id = $1`,
        [s.id]
      );

      states.push({
        state_id: s.id,
        state_name: s.state_name,
        vast_state: {
          vast_class: s.vast_class,
          vast_name: s.vast_name,
          vast_eks_state: s.eks_condition_estimate,
          eks_overstorey_class: s.eks_overstorey_class,
          eks_understorey_class: s.eks_understorey_class,
          eks_substate: s.eks_substate,
          link: s.link,
        },
        condition_upper: s.condition_upper,
        condition_lower: s.condition_lower,
        eks_condition_estimate: s.eks_condition_estimate,
        elicitation_type: s.ellictation_type,
        attributes: attrsRes.rows,
      });
    }

    // Get transitions + causal_chain
    const transRes = await client.query(
      `SELECT t.id, t.stm_name, t.start_state_id, t.end_state_id,
              t.time_25, t.time_100, t.likelihood_25, t.likelihood_100,
              t.transition_delta
       FROM transitions t
       WHERE t.stm_name = $1`,
      [name]
    );

    const transitions: TransitionData[] = [];
    for (const t of transRes.rows) {
      const startState = states.find(s => s.state_id === t.start_state_id);
      const endState = states.find(s => s.state_id === t.end_state_id);

      const causalRes = await client.query(
        `SELECT name, chain_part, driver_id
         FROM causal_chain
         WHERE transition_id = $1`,
        [t.id]
      );

      transitions.push({
        transition_id: t.id,
        stm_name: t.stm_name,
        start_state: startState?.state_name || '',
        start_state_id: t.start_state_id,
        end_state: endState?.state_name || '',
        end_state_id: t.end_state_id,
        time_25: t.time_25,
        time_100: t.time_100,
        likelihood_25: t.likelihood_25,
        likelihood_100: t.likelihood_100,
        notes: '',
        causal_chain: causalRes.rows,
        transition_delta: t.transition_delta,
      });
    }

    // Get method_alignment（1st method_name）
    const methodRes = await client.query(
      `SELECT method_name
       FROM method_alignment
       WHERE stm_name = $1
       LIMIT 1`,
      [name]
    );

    const model: BMRGData = {
      stm_name: row.stm_name,
      version: row.version,
      release_date: row.release_date,
      authorised_by: row.authorised_by,
      contributing_experts: contributorsRes.rows,
      region: row.region,
      region_id: row.region_id,
      climate: row.climate,
      ecosystem_type: row.ecosystem_type,
      aus_eco_archetype_code: row.aus_eco_archetype_code,
      aus_eco_archetype_name: row.aus_eco_archetype_name,
      aus_eco_umbrella_code: row.aus_eco_umbrella_code,
      peer_reviewed: row.peer_reviewed,
      no_peer_reviewers: row.no_peer_reviewers,
      states,
      transitions,
      method_alignment: methodRes.rows[0]?.method_name || '',
    };

    return model;
  } catch(error){
    throw error;
  } finally {
    client.release();
  }
}