import pool from '../../config/database';
import type { BMRGData, Contributor, StateData, TransitionData } from '../../types/models.types';
import type { PoolClient } from 'pg';
import { calcTransitionDelta } from '../../utils/transition.utils';

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
      const [, monthStr, yearStr] = match;
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
export async function buildDynamicUpdate<IdT extends number | string>(
  client: Pick<PoolClient, 'query'>,
  tableName: string,
  idColumn: string,
  idValue: IdT,
  updateMap: Record<string, unknown>
): Promise<IdT | null> {
  // Build SET clause dynamically (only include fields that are not undefined)
  const fields: string[] = [];
  const values: unknown[] = [];

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
export async function upsertModelMetadata(client: Pick<PoolClient, 'query'>, modelData: BMRGData): Promise<number> {
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
    const modelUpdate = await buildDynamicUpdate(client, 'stmmodel', 'id', id, {
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

    return modelUpdate as number;

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
    } catch (err: unknown) {
      const pgErr = err as { code?: string };
      // Check for Postgres unique constraint violation (conflict)
      if (pgErr.code === "23505") {
        throw {
          status: 409, // HTTP Conflict
          message: `A model with the name ${stm_name} already exists`,
        };
      }
      // Re-throw any other error
      throw {
        status: 500,
        message: `Database error: ${(err as Error).message || String(err)}`,
      }
    }
    // stmmodel id
    const modelId = modelResult.rows[0]?.id;
    return modelId;
  }

}

// 2. Upsert contributors
export async function upsertContributors(client: Pick<PoolClient, 'query'>, modelId: number, contributors: Contributor[]) {
  if (!contributors?.length) return;
  for (const expert of contributors) {
    const email = expert.email?.trim().toLowerCase();
    let contributorId = expert.contributor_id ?? null;

    // 1) Resolve contributor_id: by explicit id, else by email, else insert
    if (!contributorId) {
      const { rows: found } = await client.query(
        `SELECT id FROM contributors WHERE LOWER(email) = $1 LIMIT 1`,
        [email]
      );
      if (found.length) {
        contributorId = found[0].id;
      } else {
        const { rows: inserted } = await client.query(
          `INSERT INTO contributors (name, email) VALUES ($1, $2) RETURNING id`,
          [expert.name, email]
        );
        contributorId = inserted[0].id;
      }
    } else {
      // make sure the person exists; if yes, update name/email (id is the source of truth)
      await client.query(
        `UPDATE contributors SET name = $1, email = $2 WHERE id = $3`,
        [expert.name, email, contributorId]
      );
    }

    // 2) Upsert the per-model role/link
    await client.query(
      `INSERT INTO model_contributions (stm_id, contributor_id, contribution_type)
       VALUES ($1, $2, $3)
       ON CONFLICT (stm_id, contributor_id)
       DO UPDATE SET contribution_type = EXCLUDED.contribution_type`,
      [modelId, contributorId, expert.contribution_type]
    );
  }
}

// 3. Upsert states & vast_states & state_attributes
export async function upsertStates(client: Pick<PoolClient, 'query'>, stm_name: string, states: StateData[]): Promise<Record<number, number>> {
  // frontend_state_id -> real_state_id mapping
  const stateMap: Record<number, number> = {};

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
        await buildDynamicUpdate(
          client,
          "vast_states",
          "id",
          state.vast_state.vast_state_id,
          {
            vast_class: vastClass,
            vast_name: state.vast_state.vast_name,
            eks_overstorey_class: state.vast_state.eks_overstorey_class,
            eks_understorey_class: state.vast_state.eks_understorey_class,
            // The following fields are not part of StateData type; include only if schema expects them
            // vast_condition_lower / vast_condition_upper / eks_substate_condition_estimate are omitted intentionally
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
            // vast_condition_lower
            undefined,
            // vast_condition_upper
            undefined,
            // eks_substate_condition_estimate
            undefined,
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
      const existingStateId = state.state_id!; // safe due to if (stateId) guard
      await buildDynamicUpdate(
        client,
        "states",
        "id",
        existingStateId,
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

      // Ensure we have a concrete number from here on
      if (stateId == null) {
        throw new Error("Upsert state failed: no id returned from database");
      }
    }

    // Map frontend_state_id to real state_id
    if (state.frontend_state_id != null) {
      stateMap[state.frontend_state_id] = stateId;
    } else {
      stateMap[stateId] = stateId;
    }

    // 3.3 Upsert state_attributes
    // attributes need to be an array of objects with attribute_type, value, units
    if (state.attributes && Array.isArray(state.attributes)) {
      for (const attr of state.attributes) {
        if (attr.state_attribute_id) {
          // --- UPDATE existing attribute with dynamic fields ---
          await buildDynamicUpdate(
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

  return stateMap;
}

// 4. Upsert transitions & causal_chain & drivers
export async function upsertTransitions(client: Pick<PoolClient, 'query'>, stm_name: string, transitions: TransitionData[], stateMap: Record<number, number>): Promise<number[]> {
  const transitionIds: number[] = [];
  for (const transition of transitions) {
    // There is notes field in the TransitionData type, but no such column in the database
    // 4.1 Upsert transition
    let transitionId = transition.id; // may be undefined for new transitions

    const startStateId = stateMap[transition.start_state_id] ? stateMap[transition.start_state_id] : transition.start_state_id;
    const endStateId = stateMap[transition.end_state_id] ? stateMap[transition.end_state_id] : transition.end_state_id;

    const hasOwn = (key: string) => Object.prototype.hasOwnProperty.call(transition, key);
    const shouldRecomputeDeltaOnUpdate =
      hasOwn('likelihood_25') &&
      hasOwn('likelihood_100') &&
      hasOwn('time_25') &&
      hasOwn('time_100');

    const time100 = transition.time_100 ?? null;
    const time25 = transition.time_25 ?? null;
    const likelihood25 = transition.likelihood_25 ?? null;
    const likelihood100 = transition.likelihood_100 ?? null;

    const computedDelta = calcTransitionDelta(
      likelihood25,
      likelihood100,
      time25,
      time100
    );

    if (transitionId) {
      // --- UPDATE existing transition with dynamic fields ---
      await buildDynamicUpdate(
        client,
        "transitions",
        "id",
        transitionId,
        {
          stm_name: stm_name,
          start_state_id: startStateId,  // start_state_id and end_state_id must exist in states table 
          end_state_id: endStateId,
          transition_id: transition.transition_id,   // is not the id of the transition, Links to the Australianeco_arche type and MVG cross walk.
          time_100: transition.time_100,
          time_25: transition.time_25,
          likelihood_25: transition.likelihood_25,
          likelihood_100: transition.likelihood_100,
          // Recompute server-side when all inputs are present in payload; otherwise, leave existing value unchanged.
          transition_delta: shouldRecomputeDeltaOnUpdate ? computedDelta : undefined
        }
      );

    } else {
      // --- INSERT or UPSERT transition ---
      // When transition_id is provided, use ON CONFLICT to update if a row
      // with the same (stm_name, transition_id) already exists (e.g. re-saving
      // a model whose transitions were previously persisted).
      const hasBusinessId = transition.transition_id != null;

      const transitionResult = hasBusinessId
        ? await client.query(
            `INSERT INTO transitions (
              stm_name, start_state_id, end_state_id, transition_id,
              time_100, time_25, likelihood_25, likelihood_100, transition_delta
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (stm_name, transition_id) DO UPDATE SET
              start_state_id   = EXCLUDED.start_state_id,
              end_state_id     = EXCLUDED.end_state_id,
              time_100         = EXCLUDED.time_100,
              time_25          = EXCLUDED.time_25,
              likelihood_25    = EXCLUDED.likelihood_25,
              likelihood_100   = EXCLUDED.likelihood_100,
              transition_delta = EXCLUDED.transition_delta
            RETURNING id`,
            [
              stm_name,
              startStateId,
              endStateId,
              transition.transition_id,
              time100,
              time25,
              likelihood25,
              likelihood100,
              computedDelta
            ]
          )
        : await client.query(
            `INSERT INTO transitions (
              stm_name, start_state_id, end_state_id, transition_id,
              time_100, time_25, likelihood_25, likelihood_100, transition_delta
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id`,
            [
              stm_name,
              startStateId,
              endStateId,
              transition.transition_id,
              time100,
              time25,
              likelihood25,
              likelihood100,
              computedDelta
            ]
          );

      transitionId = transitionResult.rows[0].id;
      if (typeof transitionId === 'number') transitionIds.push(transitionId);
    }

    // 4.2 Upsert causal_chain & drivers
    for (const chain of transition.causal_chain || []) {
      // 4.2.1 Upsert causal_chain
      let chainId = chain.causal_chain_id // may be undefined for new causal_chain
      // normalize chain_part to match ENUM in the database
      const chainPartMap: Record<string, string> = {
        "management intervention": "Management Intervention",
        "favorable abiotic factor": "Favorable abiotic factor",
        "favourable abiotic factor": "Favorable abiotic factor",
        "biotic process": "Biotic process",
        "hazard": "Hazard"
      };
      // Normalize/validate chain_part and make its type explicit
      let chainPart: string | null | undefined;
      if (!('chain_part' in chain)) {
        // property not provided -> skip updating this column
        chainPart = undefined;
      } else if (chain.chain_part === null) {
        // property provided explicitly as null -> clear the column
        chainPart = null;
      } else if (typeof chain.chain_part === 'string' && chain.chain_part.trim() !== '') {
        // safe to call .toLowerCase() because of typeof check
        const mapped = chainPartMap[chain.chain_part.toLowerCase()];
        if (!mapped) {
          throw new Error(`Invalid chain_part: ${chain.chain_part}`);
        }
        chainPart = mapped;
      } else {
        // provided but empty string -> treat as explicit clear
        chainPart = null;
      }

      if (chainId) {
        // --- UPDATE existing causal_chain with dynamic fields ---
        await buildDynamicUpdate(
          client,
          "causal_chain",
          "id",
          chainId,
          {
            transition_id: transitionId,
            name: chain.name,
            chain_part: chainPart,
          }
        );
      } else {
        const chainResult = await client.query(
          `INSERT INTO causal_chain (transition_id, name, chain_part)
          VALUES ($1, $2, $3)
          RETURNING id`,
          [
            transitionId,
            chain.name,
            chainPart,
          ]
        );
        chainId = chainResult.rows[0]?.id;
      }

      // 4.2.1 Upsert drivers
      const driverIds: number[] = [];
      for (const driver of chain.drivers || []) {
        let driverId = driver.driver_id;  // may be undefined for new drivers
        if (driverId) {
          // --- UPDATE existing driver with dynamic fields ---
          await buildDynamicUpdate(
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
          if (typeof driverId === 'number') driverIds.push(driverId);
        }

        // 4.2.3 update chain_drivers junction table
        // get existing ids for this chain_driver
        let chain_driver_Id: number | null = null;
        // Await the query result first, then inspect rows. Avoid chaining .then on the
        // returned value because in tests the mock may return undefined for extra calls.
        const chainDriverRes = await client.query(
          `SELECT id FROM chain_driver WHERE causal_chain_id = $1 and driver_id = $2`,
          [chainId, driverId]
        );
        if (chainDriverRes && Array.isArray(chainDriverRes.rows) && chainDriverRes.rows.length > 0) {
          chain_driver_Id = chainDriverRes.rows[0].id;
        } else {
          chain_driver_Id = null;
        }

        // if not exist, insert new record
        if (!chain_driver_Id) {
          await client.query(
            `INSERT INTO chain_driver (causal_chain_id, driver_id)
            VALUES ($1, $2)
            RETURNING id`,
            [chainId, driverId]
          );
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
    let stateMap: Record<number, number> = {};
    if (modelData.states != undefined && modelData.states != null) {
      stateMap = await upsertStates(client, stm_name, modelData.states);
    }
    // 4. Upsert transitions & causal_chain & drivers
    if (modelData.transitions != undefined && modelData.transitions != null) {
      await upsertTransitions(client, stm_name, modelData.transitions, stateMap);
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
    throw {
      status: error && typeof error === 'object' && 'status' in error ? (error as { status: number }).status : 500,
      message: error && typeof error === 'object' && 'message' in error ? (error as { message: string }).message : (error as Error).message || String(error),
    };
  } finally {
    client.release();
  }
}