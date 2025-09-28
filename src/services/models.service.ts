import pool from '../config/database';
import { BMRGData, StateData, TransitionData } from '../types/types';
import e from 'express';
import { error, log } from 'console';


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
      `SELECT name, email, contibution_type
       FROM contributors
       WHERE stm_id = $1`,
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
  } finally {
    client.release();
  }
}


// ---------- Utility functions ----------
function normalizeReleaseDate(release_date?: string): string | null {
    // Normalize release_date (e.g., "Aug-24" → "YYYY-08-24", assuming current year)
    let normalizedReleaseDate: string | null = null;
    if (release_date) {
      const monthMap: Record<string, string> = {
        Jan: '01',
        Feb: '02',
        Mar: '03',
        Apr: '04',
        May: '05',
        Jun: '06',
        Jul: '07',
        Aug: '08',
        Sep: '09',
        Oct: '10',
        Nov: '11',
        Dec: '12'
      };

      const match = release_date.match(/^([A-Za-z]{3})-(\d{1,2})$/); // e.g., "Aug-24"
      if (match) {
        const [_, monthStr, yearStr] = match;
        const monthNum = monthMap[monthStr];
        if (monthNum) {
          const fullYear = `20${yearStr.padStart(2,'0')}`; // "24" -> "2024"
          normalizedReleaseDate = `${fullYear}-${monthNum}-01`; // Use first day of month
        }
      } else if (!isNaN(Date.parse(release_date))) {
        normalizedReleaseDate = new Date(release_date).toISOString().split('T')[0]; // already in a valid date format
      } else {
        throw new Error(`Invalid release_date format: ${release_date}`);
      }
    }

    return normalizedReleaseDate;
}

// ---------- DB upsert helpers ----------
// 1. Upsert main model
async function upsertModelMetadata(client: any, modelData: BMRGData): Promise<number> {
    const {
      id,
      stm_name,
      version,
      release_date,
      authorised_by,
      region,
      region_id,
      climate,
      ecosystem_type,
      aus_eco_archetype_code,
      aus_eco_archetype_name,
      aus_eco_umbrella_code,
      peer_reviewed,
      no_peer_reviewers,
    } = modelData;
    // Normalize release_date (e.g., "Aug-24" → "YYYY-08-24", assuming current year)
    const normalizedReleaseDate = normalizeReleaseDate(release_date);

    // modelId
    let modelResult;
    // Upsert main model data
    if (id) {
      // --- UPDATE existing record ---
      // Build SET clause dynamically (only include fields that are not undefined)
      const fields: string[] = [];
      const values: any[] = [];

      const updateMap: Record<string, any> = {
        stm_name,
        version,
        release_date,
        authorised_by,
        region,
        region_id,
        ecosystem_type,
        aus_eco_archetype_code: aus_eco_archetype_code !== undefined ? String(aus_eco_archetype_code) : undefined,
        aus_eco_archetype_name,
        aus_eco_umbrella_code,
        peer_reviewed,
        no_peer_reviewers,
        climate,
      };
      
      if(release_date != undefined){
        updateMap['release_date'] = normalizedReleaseDate;
      }
        
      let i = 1;
      for (const [key, value] of Object.entries(updateMap)) {
        if (value !== undefined) {
          fields.push(`${key} = $${i}`);
          values.push(value); // null will clear the column
          i++;
        }
      }

      if (fields.length === 0) {
        throw { status: 400, message: "No fields to update" };
      }

      values.push(id); // last param is id
      const query = `
        UPDATE stmmodel
        SET ${fields.join(", ")}
        WHERE id = $${i}
        RETURNING id
      `;

      modelResult = await client.query(query, values);

      // Ensure record exists
      if (modelResult.rows.length === 0) {
        throw { status: 404, message: `stmmodel with id ${id} not found` };
      }

    }else{
      // Insert new record or update if stm_name exists
      // chreck region_id exists in regions table
      const regionCheck = await client.query('SELECT id FROM regions WHERE id = $1', [region_id]);
      if (regionCheck.rows.length === 0) {
        throw new Error(`region_id ${region_id} not exist regions table`);
      }
      try {
        modelResult = await client.query(
          `INSERT INTO stmmodel (
            stm_name, version, release_date, authorised_by, region, region_id, ecosystem_type,
            aus_eco_archetype_code, aus_eco_archetype_name, aus_eco_umbrella_code, peer_reviewed, no_peer_reviewers, climate
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          RETURNING id`,
          [
            stm_name, version, normalizedReleaseDate, authorised_by, region, region_id, ecosystem_type,
            String(aus_eco_archetype_code), aus_eco_archetype_name, aus_eco_umbrella_code, peer_reviewed, no_peer_reviewers, climate
          ]
        );
      } catch (err: any) {
        // Check for Postgres unique constraint violation (conflict)
        if (err.code === "23505") {
          throw {
            status: 409, // HTTP Conflict
            message: `stmmodel with stm_name "${stm_name}" already exists`,
          };
        }
        // Re-throw any other error
        throw err;
      }
    }
    // stmmodel id
    const modelId = modelResult.rows[0]?.id;
    return modelId;
}

// TODO: 2. Upsert contributors
async function upsertContributors(client: any, modelId: number, contributors: any[]) {
    if (contributors && contributors.length > 0) {
      for (const expert of contributors) {
        await client.query(
          `INSERT INTO contributors (stm_id, name, email, contibution_type)
           VALUES ($1, $2, $3, $4)`,
          [
            modelId,
            expert.name,
            expert.email || null,
            expert.contribution_type // database column is "contibution_type" (typo)
          ]
        );
      }
    }
}

// TODO: 3. Upsert states & vast_states & state_attributes
async function upsertStates(client: any, stm_name: string, states: any[]): Promise<number[]> {
  const stateIds: number[] = [];

  for (const state of states) {
    // 3.1 Upsert vast_state
    // There is vast_eks_state in the StateData type, but no such column in the database
    let vastStateId = null;
    if (state.vast_state) {
      // Map vast_class to match ENUM in the database
      const vastClassMap: Record<string, string> = {
        "Class I": "ClassI",
        "Class II": "ClassII",
        "Class III": "ClassIII",
        "Class IV": "ClassIV",
        "Class V": "ClassV",
        "Class VI": "ClassVI",
      };

      if (!state.vast_state?.vast_class) {
        throw new Error("Missing vast_class in state.vast_state");
      }

      const vastClass = vastClassMap[state.vast_state.vast_class];
      if (!vastClass) {
        throw new Error(`Invalid vast_class: ${state.vast_state.vast_class}`);
      }
      // Insert new vast_state
      const vastResult = await client.query(
        `INSERT INTO vast_states (
          vast_class, vast_name, eks_overstorey_class, eks_understorey_class,
          vast_condition_lower, vast_condition_upper, eks_substate_condition_estimate,
          eks_substate, link
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING id`,
        [
          vastClass,
          state.vast_state.vast_name,
          state.vast_state.eks_overstorey_class,
          state.vast_state.eks_understorey_class,
          null, // vast_condition_lower
          null, // vast_condition_upper
          null, // eks_substate_condition_estimate
          state.vast_state.eks_substate,
          state.vast_state.link
        ]
      );
      vastStateId = vastResult.rows[0]?.id;
    }

    // 3.2 Save state
    // ellictation_type must be one of the ENUM values in the database
    let elicitType = null;
    if (state.elicitation_type) {
      // Normalize the elicitation_type to match ENUM values
      if (state.elicitation_type.toLowerCase() === 'pilot region') {
        elicitType = 'Pilot region';
      } else if (state.elicitation_type.toLowerCase() === 'neap estimate') {
        elicitType = 'NEAP estimate';
      } else {
        elicitType = state.elicitation_type;
      }
    }
    const stateResult = await client.query(
      `INSERT INTO states (
        stm_name, state_name, vast_state_id, eks_condition_estimate,
        condition_lower, condition_upper, ellictation_type
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id`,
      [
        // state.id is serial in database, so don't insert it
        stm_name,
        state.state_name,
        vastStateId,
        state.eks_condition_estimate,
        state.condition_lower,
        state.condition_upper,
        elicitType
      ]
    );
    const stateId = stateResult.rows[0]?.id;
    stateIds.push(stateId);

    // 3.3 Save state_attributes
    // attributes need to be an array of objects with attribute_type, value, units
    // now it's null
    if (state.attributes && Array.isArray(state.attributes)) {
      for (const attr of state.attributes) {
        await client.query(
          `INSERT INTO state_attributes (state_id, attribute_type, value, units)
            VALUES ($1, $2, $3, $4)
            --ON CONFLICT (id) DO NOTHING`,
          [
            stateId,
            attr.attribute_type, // must match the ENUM in the database
            attr.value,
            attr.units
          ]
        );
      }
    }
  }

  return stateIds;
}

// TODO: 4. Upsert transitions & causal_chain & drivers
async function upsertTransitions(client: any, stm_name: string, states: number[], transitions: any[]) {
  
  for (const transition of transitions) {
    // There is notes field in the TransitionData type, but no such column in the database
    // 4.1 Save transition
    const transitionResult = await client.query(
      `INSERT INTO transitions (
        stm_name, start_state_id, end_state_id, transition_id,
        time_100, time_25, likelihood_25, likelihood_100, transition_delta
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id
      --ON CONFLICT (transition_id) DO NOTHING`,
      [
        // transition.id is serial in database, so don't insert it
        stm_name,
        // beacuse stateId is a serial, so here start_state_id is the current stateId to test
        states[0], // Change to transition.start_state_id later
        states[0], // Change to transition.end_state_id later
        transition.transition_id,
        transition.time_100,
        transition.time_25,
        transition.likelihood_25,
        transition.likelihood_100,
        transition.transition_delta
      ]
    );
    const transitionId = transitionResult.rows[0].id;

    // 4.2 Save causal_chain
    for (const chain of transition.causal_chain || []) {
      // traverse drivers
      for (const driver of chain.drivers || []) {
        // find or insert driver
        let driverId: number | null = null;
        const driverResult = await client.query(
          `SELECT id FROM drivers WHERE driver = $1 AND driver_group = $2`,
          [driver.driver, driver.driver_group]
        );
        if (driverResult.rows.length > 0) {
          driverId = driverResult.rows[0].id;
        } else {
          const insertDriver = await client.query(
            `INSERT INTO drivers (driver, driver_group) VALUES ($1, $2) RETURNING id`,
            [driver.driver, driver.driver_group]
          );
          driverId = insertDriver.rows[0].id;
        }
        // normalize chain_part to match ENUM in the database
        const chainPartMap: Record<string, string> = {
          "management intervention": "Management Intervention",
          "favorable abiotic factor": "Favorable abiotic factor",
          "favourable abiotic factor":"Favorable abiotic factor",
          "biotic process": "Biotic process",
          "hazard": "Hazard"
        };
        const chainPart = chain.chain_part
          ? chainPartMap[chain.chain_part.toLowerCase()] || chain.chain_part
          : null;
        // insert causal_chain
        await client.query(
          `INSERT INTO causal_chain (transition_id, chain_part, name, driver_id)
          VALUES ($1, $2, $3, $4)`,
          [
            transitionId,
            chainPart,
            driver.driver,
            driverId
          ]
        );
      }
    }
  }
}

// Save a new model
export async function saveModel(modelData: BMRGData) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Upsert main model
    const modelId = await upsertModelMetadata(client, modelData);
    // 2. Upsert contributors
    await upsertContributors(client, modelId, modelData.contributing_experts);
    // 3. Upsert states & vast_states & state_attributes
    const stateIds = await upsertStates(client, modelData.stm_name, modelData.states);
    // 4. Upsert transitions & causal_chain & drivers
    await upsertTransitions(client, modelData.stm_name, stateIds, modelData.transitions);
    // 5. Save method_alignment（it's "None" and it don't insert for now)
    if (modelData.method_alignment && modelData.method_alignment!== "None") {
        // will implement later
        console.log("method_alignment to be implemented:", modelData.method_alignment);
    } else {
      console.log("No method_alignment provided or it's 'None'");
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