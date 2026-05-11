import pool from '../../config/database';
import type { BMRGData, StateData, TransitionData } from '../../types/models.types';

// Get all non-template model names accessible to the given user.
// If userEmail is not provided (Admin caller), all non-template models are returned.
export async function getAllModels(userEmail?: string) {
  const client = await pool.connect();
  try {
    if (!userEmail) {
      // Admin path — return all non-template models.
      const result = await client.query(
        `SELECT stm_name FROM stmmodel WHERE is_template = false ORDER BY created_at DESC`
      );
      return result.rows.map(r => r.stm_name);
    }

    // Non-admin path — return only models the user has a permission row for.
    const result = await client.query(
      `SELECT m.stm_name
       FROM stmmodel m
       INNER JOIN model_permissions mp ON mp.stm_name = m.stm_name
       WHERE mp.user_email = $1
         AND m.is_template = false
       ORDER BY m.created_at DESC`,
      [userEmail]
    );
    return result.rows.map(r => r.stm_name);
  } finally {
    client.release();
  }
}

// Get all models (with model_role) accessible to the given user (any permission row).
// Returns only non-template models.
export async function getAssignedModels(userEmail: string): Promise<Array<{ stm_name: string; model_role: string }>> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT m.stm_name, mp.role AS model_role
       FROM stmmodel m
       INNER JOIN model_permissions mp ON mp.stm_name = m.stm_name
       WHERE mp.user_email = $1
         AND m.is_template = false
       ORDER BY m.created_at DESC`,
      [userEmail]
    );
    return result.rows;
  } finally {
    client.release();
  }
}

// Get all template model names (where is_template = TRUE)
export async function getTemplates() {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT stm_name FROM stmmodel WHERE is_template = TRUE ORDER BY stm_name`
    );
    return result.rows.map(r => r.stm_name);
  } finally {
    client.release();
  }
}

// Get model details by name, including states and transitions
export async function getModelByName(name: string): Promise<BMRGData | null> {
  const client = await pool.connect();
  try {
    const modelRes = await client.query(
      `SELECT id, stm_name, version, release_date, authorised_by,
              region, region_id, ecosystem_type,
              aus_eco_archetype_code, aus_eco_archetype_name,
              aus_eco_umbrella_code, peer_reviewed,
              no_peer_reviewers, climate, is_template,
              is_locked, locked_by, locked_at, lock_reason
       FROM stmmodel
       WHERE stm_name = $1`,
      [name]
    );

    if (modelRes.rows.length === 0) {
      return null;
    }
    const row = modelRes.rows[0];

    const contributorsRes = await client.query(
      `SELECT c.id, c.name, c.email, mc.contribution_type
         FROM model_contributions mc
         JOIN contributors c ON c.id = mc.contributor_id
        WHERE mc.stm_id = $1
        ORDER BY c.name`,
      [row.id]
    );

    const statesRes = await client.query(
      `SELECT s.id, s.state_name, s.eks_condition_estimate,
              s.condition_lower, s.condition_upper, s.ellictation_type,
              s.node_x, s.node_y,
              s.vast_state_id,
              v.id AS vast_id, v.vast_class, v.vast_name,
              v.eks_overstorey_class, v.eks_understorey_class,
              v.eks_substate, v.link
       FROM states s
       LEFT JOIN vast_states v ON s.vast_state_id = v.id
       WHERE s.stm_name = $1`,
      [name]
    );

    const vastClassDisplayMap: Record<string, string> = {
      ClassI: 'Class I', ClassII: 'Class II', ClassIII: 'Class III',
      ClassIV: 'Class IV', ClassV: 'Class V', ClassVI: 'Class VI',
    };

    const states: StateData[] = [];
    for (const s of statesRes.rows) {
      const attrsRes = await client.query(
        `SELECT id AS state_attribute_id, attribute_type, value, units
         FROM state_attributes
         WHERE state_id = $1`,
        [s.id]
      );

      states.push({
        state_id: s.id,
        state_name: s.state_name,
        vast_state: {
          vast_state_id: s.vast_state_id ?? undefined,
          vast_class: vastClassDisplayMap[s.vast_class] ?? s.vast_class,
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
        node_x: s.node_x,
        node_y: s.node_y,
        attributes: attrsRes.rows,
      });
    }

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
        `SELECT name, chain_part, driver_id FROM causal_chain WHERE transition_id = $1`,
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

    const methodRes = await client.query(
      `SELECT method_name FROM method_alignment WHERE stm_name = $1 LIMIT 1`,
      [name]
    );

    const model: BMRGData = {
      id: row.id,
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
      is_template: row.is_template,
      is_locked: row.is_locked,
      locked_by: row.locked_by,
      locked_at: row.locked_at ? String(row.locked_at) : null,
      lock_reason: row.lock_reason,
    };

    return model;
  } finally {
    client.release();
  }
}
