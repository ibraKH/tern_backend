import pool from '../config/database';
import { BMRGData, StateData, TransitionData } from '../types/types';

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
export function normalizeReleaseDate(release_date?: string): string | null {
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
        const fullYear = `20${yearStr.padStart(2, '0')}`; // "24" -> "2024"
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

// Build dynamic UPDATE query helper
export async function buildDynamicUpdate(
  client: any,
  tableName: string,
  idColumn: string,
  idValue: any,
  updateMap: Record<string, any>
): Promise<any | null> {
  // Build SET clause dynamically (only include fields that are not undefined)
  const fields: string[] = [];
  const values: any[] = [];

  for (const [key, value] of Object.entries(updateMap)) {
    // Skip undefined (not provided), but include null (to clear the field)
    if (value !== undefined) {
      fields.push(`${key} = $${values.length + 1}`);
      values.push(value); // null will clear the column
    }
  }

  if (fields.length === 0) {
    // log('No fields to update for', tableName, 'id:', idValue);
    return idValue; // Nothing to update
  }

  values.push(idValue); // last param is id
  const query = `
    UPDATE ${tableName}
    SET ${fields.join(", ")}
    WHERE ${idColumn} = $${values.length}
    RETURNING ${idColumn}
  `;

  const result = await client.query(query, values);

  if (result.rows.length === 0) {
    throw { status: 404, message: `${tableName} with ${idColumn}=${idValue} not found` };
  }

  return idValue;
}

// ---------- DB upsert helpers ----------
// 1. Upsert main model
export async function upsertModelMetadata(client: any, modelData: BMRGData): Promise<number> {
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
    const modelUpdate = buildDynamicUpdate(client, 'stmmodel', 'id', id, {
      stm_name,
      version,
      release_date: release_date != undefined ? normalizedReleaseDate : undefined,
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
    });

    return modelUpdate;

  } else {
    // Insert new record or update if stm_name exists
    // chreck region_id exists in regions table
    if (region_id) {
      const regionCheck = await client.query('SELECT id FROM regions WHERE id = $1', [region_id]);
      if (regionCheck.rows.length === 0) {
        throw new Error(`region_id ${region_id} not exist regions table`);
      }
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
          aus_eco_archetype_code, aus_eco_archetype_name, aus_eco_umbrella_code, peer_reviewed, no_peer_reviewers, climate
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
    // stmmodel id
    const modelId = modelResult.rows[0]?.id;
    return modelId;
  }

}

// 2. Upsert contributors
export async function upsertContributors(client: any, modelId: number, contributors: any[]) {
  if (contributors && contributors.length > 0) {
    for (const expert of contributors) {
      if(expert.contributor_id){
        // --- UPDATE existing contributor with dynamic fields ---
        const contUpdate = await buildDynamicUpdate(
          client,
          "contributors",
          "id",
          expert.contributor_id,
          {
            stm_id: modelId,
            name: expert.name,
            email: expert.email,
            contibution_type: expert.contribution_type // database column is "contibution_type" (typo)
          }
        );

      }else{
        // --- INSERT new contributor ---
        await client.query(
          `INSERT INTO contributors (stm_id, name, email, contibution_type)
            VALUES ($1, $2, $3, $4)`,
          [
            modelId,
            expert.name,
            expert.email,
            expert.contribution_type // database column is "contibution_type" (typo)
          ]
        );
      }

    }
  }
}

// 3. Upsert states & vast_states & state_attributes
export async function upsertStates(client: any, stm_name: string, states: any[]): Promise<number[]> {
  const stateIds: number[] = [];

  for (const state of states) {
    // 3.1 Upsert vast_state
    // There is vast_eks_state in the StateData type, but no such column in the database
    let vastStateId = null;
    if (!('vast_state' in state)) {
      vastStateId = undefined;// not clearing the field
    }
    if (state.vast_state) {
      // --- UPSERT vast_state ---
      let vastClass = null;
      // Map vast_class to match ENUM in the database
      const vastClassMap: Record<string, string> = {
        "Class I": "ClassI",
        "Class II": "ClassII",
        "Class III": "ClassIII",
        "Class IV": "ClassIV",
        "Class V": "ClassV",
        "Class VI": "ClassVI",
      };

      if (!("vast_class" in state.vast_state)) {
        vastClass = undefined; // not clearing the field
      }

      // only map if it's provided and not null
      if (state.vast_state.vast_class) {
        vastClass = vastClassMap[state.vast_state.vast_class];
        if (!vastClass) {
          throw new Error(`Invalid vast_class: ${state.vast_state.vast_class}`);
        }
      }

      if (state.vast_state.vast_state_id) {
        // --- UPDATE existing vast_state with dynamic fields ---
        const vastUpdate = buildDynamicUpdate(
          client,
          "vast_states",
          "id",
          state.vast_state.vast_state_id,
          {
            vast_class: vastClass,
            vast_name: state.vast_state.vast_name,
            eks_overstorey_class: state.vast_state.eks_overstorey_class,
            eks_understorey_class: state.vast_state.eks_understorey_class,
            vast_condition_lower: state.vast_condition_lower,
            vast_condition_upper: state.vast_condition_upper,
            eks_substate_condition_estimate: state.eks_substate_condition_estimate,
            eks_substate: state.vast_state.eks_substate,
            link: state.vast_state.link,
          });

        vastStateId = state.vast_state.vast_state_id;

      } else {
        // --- INSERT new vast_state ---
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
            state.vast_condition_lower,
            state.vast_condition_upper,
            state.eks_substate_condition_estimate,
            state.vast_state.eks_substate,
            state.vast_state.link
          ]
        );
        vastStateId = vastResult.rows[0]?.id;
      }
    }

    // 3.2 Upsert state
    // ellictation_type must be one of the ENUM values in the database
    let elicitType = null;
    if (!("elicitation_type" in state)) {
      elicitType = undefined; // not clearing the field
    }
    if (state.elicitation_type) {
      // Normalize the elicitation_type to match ENUM values
      if (state.elicitation_type.toLowerCase() === 'pilot region') {
        elicitType = 'Pilot region';
      } else if (state.elicitation_type.toLowerCase() === 'neap estimate') {
        elicitType = 'NEAP estimate';
      } else {
        throw new Error(`Invalid elicitation_type: ${state.elicitation_type}`);
      }
    }
    let stateId = state.state_id; // may be undefined for new states
    if (stateId) {
      // --- UPDATE existing state ---
      const stateUpdate = await buildDynamicUpdate(
        client,
        "states",
        "id",
        state.state_id,
        {
          stm_name: stm_name,
          state_name: state.state_name,
          vast_state_id: vastStateId,
          eks_condition_estimate: state.eks_condition_estimate,
          condition_lower: state.condition_lower,
          condition_upper: state.condition_upper,
          ellictation_type: elicitType,
        }
      );

    }
    else {
      // --- INSERT new state ---
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
      stateId = stateResult.rows[0]?.id;
      stateIds.push(stateId);
    }

    // 3.3 Upsert state_attributes
    // attributes need to be an array of objects with attribute_type, value, units
    if (state.attributes && Array.isArray(state.attributes)) {
      for (const attr of state.attributes) {
        if (attr.state_attribute_id) {
          // --- UPDATE existing attribute with dynamic fields ---
          const attrUpdate = await buildDynamicUpdate(
            client,
            "state_attributes",
            "id",
            attr.state_attribute_id,
            {
              state_id: stateId,
              attribute_type: attr.attribute_type, // must match the ENUM in the database
              value: attr.value,
              units: attr.units
            }
          );
        } else {
          // --- INSERT new attribute ---
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

  }

  return stateIds;
}

// 4. Upsert transitions & causal_chain & drivers
export async function upsertTransitions(client: any, stm_name: string, transitions: any[]): Promise<number[]> {
  const transitionIds: number[] = [];
  for (const transition of transitions) {
    // There is notes field in the TransitionData type, but no such column in the database
    // 4.1 Upsert transition
    let transitionId = transition.id; // may be undefined for new transitions

    if (transitionId) {
      // --- UPDATE existing transition with dynamic fields ---
      const transUpdate = await buildDynamicUpdate(
        client,
        "transitions",
        "id",
        transitionId,
        {
          stm_name: stm_name,
          start_state_id: transition.start_state_id,  // start_state_id and end_state_id must exist in states table 
          end_state_id: transition.end_state_id,
          transition_id: transition.transition_id,   // is not the id of the transition, Links to the Australianeco_arche type and MVG cross walk.
          time_100: transition.time_100,
          time_25: transition.time_25,
          likelihood_25: transition.likelihood_25,
          likelihood_100: transition.likelihood_100,
          transition_delta: transition.transition_delta
        }
      );

    } else {
      // --- INSERT new transition ---

      const transitionResult = await client.query(
        `INSERT INTO transitions (
          stm_name, start_state_id, end_state_id, transition_id,
          time_100, time_25, likelihood_25, likelihood_100, transition_delta
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id`,
        [
          // transition.id is serial in database, so don't insert it
          stm_name,
          transition.start_state_id,  // start_state_id and end_state_id must exist in states table
          transition.end_state_id,
          transition.transition_id,   // is not the id of the transition, Links to the Australianeco_arche type and MVG cross walk.
          transition.time_100,
          transition.time_25,
          transition.likelihood_25,
          transition.likelihood_100,
          transition.transition_delta
        ]
      );
      transitionId = transitionResult.rows[0].id;
      transitionIds.push(transitionId);
    }

    // 4.2 Upsert causal_chain & drivers
    for (const chain of transition.causal_chain || []) {

      // 4.2.1 Upsert drivers
      let driverIds: number[] = [];
      for (const driver of chain.drivers || []) {
        let driverId = driver.driver_id;  // may be undefined for new drivers
        if (driverId) {
          // --- UPDATE existing driver with dynamic fields ---
          const driverUpdate = await buildDynamicUpdate(
            client,
            "drivers",
            "id",
            driverId,
            {
              driver: driver.driver,
              description: driver.description,
              driver_group: driver.driver_group
            }
          );
        } else {
          // --- INSERT new driver ---
          const driverResult = await client.query(
            `INSERT INTO drivers (driver, description, driver_group)
            VALUES ($1, $2, $3)
            RETURNING id`,
            [
              driver.driver,
              driver.description,
              driver.driver_group
            ]
          );
          driverId = driverResult.rows[0].id;
          driverIds.push(driverId);
        }

        // 4.2.2 Upsert causal_chain
        let chainId = chain.causal_chain_id // may be undefined for new causal_chain
        // normalize chain_part to match ENUM in the database
        const chainPartMap: Record<string, string> = {
          "management intervention": "Management Intervention",
          "favorable abiotic factor": "Favorable abiotic factor",
          "favourable abiotic factor": "Favorable abiotic factor",
          "biotic process": "Biotic process",
          "hazard": "Hazard"
        };
        let chainPart = chain.chain_part;
        if (!("chain_part" in chain)) {
          chainPart = undefined; // not clearing the field
        } else if (chain.chain_part) {
          chainPart = chainPartMap[chainPart.toLowerCase()];
          if (!chainPart) {
            throw new Error(`Invalid chain_part: ${chain.chain_part}`);
          }
        }

        // Ensure transition_id is set in the causal_chain
        let transition_id_aus = transition.transition_id;
        if (transition_id_aus === undefined) {
          const result = await client.query(
            `SELECT transition_id FROM transitions
            WHERE id = $1`,
            [transitionId]
          );

          if (result.rows.length > 0) {
            transition_id_aus = result.rows[0].transition_id;
          } else {
            throw new Error(`transition_id not found for transition with stm_name ${stm_name}, start_state_id ${transition.start_state_id}, end_state_id ${transition.end_state_id}`);
          }
        }


        if (chainId) {
          // --- UPDATE existing causal_chain with dynamic fields ---
          const chainUpdate = await buildDynamicUpdate(
            client,
            "causal_chain",
            "id",
            chainId,
            {
              transition_id: transition_id_aus,
              name: chain.name,
              chain_part: chainPart,
              driver_id: driverId
            }
          );
        } else {
          const chainResult = await client.query(
            `INSERT INTO causal_chain (transition_id, name, chain_part, driver_id)
            VALUES ($1, $2, $3, $4)`,
            [
              transition_id_aus,
              chain.name,
              chainPart,
              driverId
            ]
          );
          chainId = chainResult.rows[0]?.id;
        }

      }

    }

  }

  return transitionIds;
}

// Save a new model
export async function saveModel(modelData: BMRGData) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Upsert main model
    const modelId = await upsertModelMetadata(client, modelData);
    // If stm_name not provided in modelData, fetch it from the database using modelId
    let stm_name = modelData.stm_name;
    if (!stm_name || stm_name.trim() === "") {
      const res = await client.query(
        `SELECT stm_name FROM stmmodel WHERE id = $1`,
        [modelId]
      );
      if (res.rows.length > 0) {
        stm_name = res.rows[0].stm_name;
      } else {
        throw new Error(`stm_name not found for model id ${modelId}`);
      }
    }
    // 2. Upsert contributors
    if (modelData.contributing_experts != undefined && modelData.contributing_experts != null) {
      await upsertContributors(client, modelId, modelData.contributing_experts);
    }
    // 3. Upsert states & vast_states & state_attributes
    let stateIds: number[] = [];
    if (modelData.states != undefined && modelData.states != null) {
      stateIds = await upsertStates(client, stm_name, modelData.states);
    }
    // 4. Upsert transitions & causal_chain & drivers
    let transitionIds: number[] = [];
    if (modelData.transitions != undefined && modelData.transitions != null) {
      transitionIds = await upsertTransitions(client, stm_name, modelData.transitions);
    }

    // // 5. Save method_alignment（it's "None" and it don't insert for now)
    // if (modelData.method_alignment && modelData.method_alignment!== "None") {
    //     // will implement later
    //     console.log("method_alignment to be implemented:", modelData.method_alignment);
    // } else {
    //   console.log("No method_alignment provided or it's 'None'");
    // }

    await client.query('COMMIT');
    return { modelId };

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}