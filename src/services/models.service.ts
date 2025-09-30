import pool from '../config/database';
import { BMRGData, StateData, TransitionData } from '../types/types';
import e from 'express';
import { error, log } from 'console';


console.log('PG_USER:', process.env.PG_USER, typeof process.env.PG_USER
);
console.log('PG_PASSWORD:', process.env.PG_PASSWORD, typeof process.env.PG_PASSWORD
);
console.log('PG_HOST:', process.env.PG_HOST, typeof process.env.PG_HOST
);
console.log('PG_DB:', process.env.PG_DB, typeof process.env.PG_DB
);
console.log('PG_PORT:', process.env.PG_PORT, typeof process.env.PG_PORT
);
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

// --- Fetch model basic info ---
async function fetchModelBasicInfo(client: any, name: string) {
  const res = await client.query(
    `SELECT id, stm_name, version, release_date, authorised_by,
            region, region_id, ecosystem_type,
            aus_eco_archetype_code, aus_eco_archetype_name,
            aus_eco_umbrella_code, peer_reviewed,
            no_peer_reviewers, climate
     FROM stmmodel
     WHERE stm_name = $1`,
    [name]
  );
  return res.rows[0] || null;
}

// --- Fetch contributors ---
async function fetchContributors(client: any, stmId: number) {
  const res = await client.query(
    `SELECT name, email, contibution_type
     FROM contributors
     WHERE stm_id = $1`,
    [stmId]
  );
  return res.rows;
}

// --- Fetch states and attributes ---
async function fetchStates(client: any, stmName: string): Promise<StateData[]> {
  const statesRes = await client.query(
    `SELECT s.id, s.state_name, s.eks_condition_estimate,
            s.condition_lower, s.condition_upper, s.ellictation_type,
            v.vast_class, v.vast_name, v.eks_overstorey_class,
            v.eks_understorey_class, v.eks_substate, v.link
     FROM states s
     LEFT JOIN vast_states v ON s.vast_state_id = v.id
     WHERE s.stm_name = $1`,
    [stmName]
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
  return states;
}

// --- Fetch transitions and causal chain ---
async function fetchTransitions(
  client: any,
  stmName: string,
  states: StateData[]
): Promise<TransitionData[]> {
  const transRes = await client.query(
    `SELECT t.id, t.stm_name, t.start_state_id, t.end_state_id,
            t.time_25, t.time_100, t.likelihood_25, t.likelihood_100,
            t.transition_delta
     FROM transitions t
     WHERE t.stm_name = $1`,
    [stmName]
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
  return transitions;
}

// --- Fetch method alignment ---
async function fetchMethodAlignment(client: any, stmName: string) {
  const res = await client.query(
    `SELECT method_name
     FROM method_alignment
     WHERE stm_name = $1
     LIMIT 1`,
    [stmName]
  );
  return res.rows[0]?.method_name || '';
}

// --- Main function: orchestrates all fetches ---
export async function getModelByName(name: string): Promise<BMRGData | null> {
  const client = await pool.connect();
  try {
    const row = await fetchModelBasicInfo(client, name);
    if (!row) return null;

    const contributors = await fetchContributors(client, row.id);
    const states = await fetchStates(client, row.stm_name);
    const transitions = await fetchTransitions(client, row.stm_name, states);
    const method_alignment = await fetchMethodAlignment(client, row.stm_name);

    const model: BMRGData = {
      stm_name: row.stm_name,
      version: row.version,
      release_date: row.release_date,
      authorised_by: row.authorised_by,
      contributing_experts: contributors,
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
      method_alignment,
    };

    return model;
  } finally {
    client.release();
  }
}



export async function saveModel(modelData: BMRGData) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Save main model
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
        const [_, monthStr, day] = match;
        const monthNum = monthMap[monthStr];
        if (monthNum) {
          const currentYear = new Date().getFullYear();
          normalizedReleaseDate = `${currentYear}-${monthNum}-${day.padStart(2, '0')}`; // YYYY-MM-DD
        }
      } else if (!isNaN(Date.parse(release_date))) {
        normalizedReleaseDate = new Date(release_date).toISOString().split('T')[0]; // already in a valid date format
      } else {
        throw new Error(`Invalid release_date format: ${release_date}`);
      }
    }

    // chreck region_id exists in regions table
    const regionCheck = await client.query('SELECT id FROM regions WHERE id = $1', [region_id]);
    if (regionCheck.rows.length === 0) {
      throw new Error(`region_id ${region_id} not exist regions table`);
    }

    // Insert main model data
    const modelResult = await client.query(
      `INSERT INTO stmmodel (
        stm_name, version, release_date, authorised_by, region, region_id, ecosystem_type,
        aus_eco_archetype_code, aus_eco_archetype_name, aus_eco_umbrella_code, peer_reviewed, no_peer_reviewers, climate
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      --ON CONFLICT (stm_name) DO NOTHING
      RETURNING id`,
      [
        stm_name, version, normalizedReleaseDate, authorised_by, region, region_id, ecosystem_type,
        String(aus_eco_archetype_code), aus_eco_archetype_name, aus_eco_umbrella_code, peer_reviewed, no_peer_reviewers, climate
      ]
    );
    // stmmodel id
    const modelId = modelResult.rows[0]?.id;


    // 2. Save contributors
    if (contributing_experts && contributing_experts.length > 0) {
      for (const expert of contributing_experts) {
        await client.query(
          `INSERT INTO contributors (stm_id, name, email, contibution_type)
           VALUES ($1, $2, $3, $4)
           --ON CONFLICT DO NOTHING`,
          [
            modelId,
            expert.name,
            expert.email || null,
            expert.contribution_type // database column is "contibution_type" (typo)
          ]
        );
      }
    }


    // 3. Save states & vast_states & state_attributes
    for (const state of states) {
      // 3.1 Save vast_state
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

        const vastClass = state.vast_state?.vast_class
          ? vastClassMap[state.vast_state.vast_class] || state.vast_state.vast_class
          : null;

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
          stm_name, state_name, vast_state_id, eks_condition_estimate, condition_lower, condition_upper, ellictation_type
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


      // 3.3 Save state_attributes
      // attributes need to be an array of objects with attribute_type, value, units
      // now it's null
      if (state.attributes && Array.isArray(state.attributes)) {
        for (const attr of state.attributes) {
          await client.query(
            `INSERT INTO state_attributes (state_id, attribute_type, value, units)
             VALUES ($1, $2, $3, $4)
             --ON CONFLICT (state_id, attribute_type) DO NOTHING`,
            [
              stateId,
              attr.attribute_type, // must match the ENUM in the database
              attr.value,
              attr.units || null
            ]
          );
        }
      }


      // 4. Save transitions
      for (const transition of transitions) {
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
            stateId, // Change to transition.start_state_id later
            stateId, // Change to transition.start_state_id later
            transition.transition_id,
            transition.time_100,
            transition.time_25,
            transition.likelihood_25,
            transition.likelihood_100,
            transition.transition_delta
          ]
        );

        const transitionId = transitionResult.rows[0].id;

        // 4.1 Save causal_chain
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

    // 5. Save method_alignment（it's "None" and it don't insert for now)
    if (method_alignment && method_alignment!== "None") {
        // will implement later
        console.log("method_alignment to be implemented:", method_alignment);
    } else {
      console.log("No method_alignment provided or it's 'None'");
    }

    await client.query('COMMIT');
    return { modelId };
  }
} catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}