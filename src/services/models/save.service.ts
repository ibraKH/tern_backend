import pool from '../../config/database';
import type { BMRGData, Contributor, StateData, TransitionData } from '../../types/models.types';
import type { PoolClient } from 'pg';
import { calcTransitionDelta } from '../../utils/transition.utils';
import { assertModelUnlocked, assertModelUnlockedById } from './reviewLock.service';
import { ConflictError } from '../../errors';

// Template names reserved by the system — users cannot create models with these names.
const PROTECTED_TEMPLATE_NAMES: string[] = ['Woodlands', 'Grasslands', 'Shrublands'];

// ---------- Utility functions ----------
export function normalizeReleaseDate(release_date?: string): string | null {
  let normalizedReleaseDate: string | null = null;
  if (release_date) {
    const monthMap: Record<string, string> = {
      Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
      Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
    };

    const match = release_date.match(/^([A-Za-z]{3})-(\d{1,2})$/);
    if (match) {
      const [, monthStr, yearStr] = match;
      const monthNum = monthMap[monthStr];
      if (monthNum) {
        const fullYear = `20${yearStr.padStart(2, '0')}`;
        normalizedReleaseDate = `${fullYear}-${monthNum}-01`;
      }
    } else if (!isNaN(Date.parse(release_date))) {
      normalizedReleaseDate = new Date(release_date).toISOString().split('T')[0];
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
  const fields: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(updateMap)) {
    if (value !== undefined) {
      fields.push(`${key} = $${values.length + 1}`);
      values.push(value);
    }
  }

  if (fields.length === 0) {
    return idValue;
  }

  values.push(idValue);
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
export async function upsertModelMetadata(
  client: Pick<PoolClient, 'query'>,
  modelData: BMRGData,
  creatorEmail?: string,
): Promise<number> {
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
  const normalizedReleaseDate = normalizeReleaseDate(release_date);
  let modelResult;

  if (id) {
    // --- UPDATE existing record ---
    // authorised_by is intentionally omitted: do not overwrite the original value.
    const modelUpdate = await buildDynamicUpdate(client, 'stmmodel', 'id', id, {
      stm_name,
      version,
      release_date: release_date != undefined ? normalizedReleaseDate : undefined,
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
    // Insert new record
    if (region_id) {
      const regionCheck = await client.query('SELECT id FROM regions WHERE id = $1', [region_id]);
      if (regionCheck.rows.length === 0) {
        throw new Error(`region_id ${region_id} not exist regions table`);
      }
    }
    // authorised_by comes from the server-supplied creatorEmail, not from the request body.
    const serverAuthorisedBy = creatorEmail ?? authorised_by ?? null;
    try {
      modelResult = await client.query(
        `INSERT INTO stmmodel (
            stm_name, version, release_date, authorised_by, region, region_id, ecosystem_type,
            aus_eco_archetype_code, aus_eco_archetype_name, aus_eco_umbrella_code, peer_reviewed, no_peer_reviewers, climate
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          RETURNING id`,
        [
          stm_name, version, normalizedReleaseDate, serverAuthorisedBy, region, region_id, ecosystem_type,
          aus_eco_archetype_code, aus_eco_archetype_name, aus_eco_umbrella_code, peer_reviewed, no_peer_reviewers, climate
        ]
      );
    } catch (err: unknown) {
      const pgErr = err as { code?: string };
      if (pgErr.code === "23505") {
        throw {
          status: 409,
          message: `A model with the name ${stm_name} already exists`,
        };
      }
      throw {
        status: 500,
        message: `Database error: ${(err as Error).message || String(err)}`,
      };
    }
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
      await client.query(
        `UPDATE contributors SET name = $1, email = $2 WHERE id = $3`,
        [expert.name, email, contributorId]
      );
    }

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
  const stateMap: Record<number, number> = {};

  for (const state of states) {
    let vastStateId = null;
    if (!('vast_state' in state)) {
      vastStateId = undefined;
    }
    if (state.vast_state) {
      let vastClass = null;
      const vastClassMap: Record<string, string> = {
        "Class I": "ClassI", "Class II": "ClassII", "Class III": "ClassIII",
        "Class IV": "ClassIV", "Class V": "ClassV", "Class VI": "ClassVI",
      };

      if (!("vast_class" in state.vast_state)) {
        vastClass = undefined;
      }

      if (state.vast_state.vast_class) {
        vastClass = vastClassMap[state.vast_state.vast_class];
        if (!vastClass) {
          throw new Error(`Invalid vast_class: ${state.vast_state.vast_class}`);
        }
      }

      if (state.vast_state.vast_state_id) {
        await buildDynamicUpdate(
          client, "vast_states", "id", state.vast_state.vast_state_id,
          {
            vast_class: vastClass,
            vast_name: state.vast_state.vast_name,
            eks_overstorey_class: state.vast_state.eks_overstorey_class,
            eks_understorey_class: state.vast_state.eks_understorey_class,
            eks_substate: state.vast_state.eks_substate,
            link: state.vast_state.link,
          });

        vastStateId = state.vast_state.vast_state_id;

      } else {
        const vastResult = await client.query(
          `INSERT INTO vast_states (
            vast_class, vast_name, eks_overstorey_class, eks_understorey_class,
            vast_condition_lower, vast_condition_upper, eks_substate_condition_estimate,
            eks_substate, link
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          RETURNING id`,
          [
            vastClass, state.vast_state.vast_name, state.vast_state.eks_overstorey_class,
            state.vast_state.eks_understorey_class, undefined, undefined, undefined,
            state.vast_state.eks_substate, state.vast_state.link
          ]
        );
        vastStateId = vastResult.rows[0]?.id;
      }
    }

    let elicitType = null;
    if (!("elicitation_type" in state)) {
      elicitType = undefined;
    }
    if (state.elicitation_type) {
      if (state.elicitation_type.toLowerCase() === 'pilot region') {
        elicitType = 'Pilot region';
      } else if (state.elicitation_type.toLowerCase() === 'neap estimate') {
        elicitType = 'NEAP estimate';
      } else {
        throw new Error(`Invalid elicitation_type: ${state.elicitation_type}`);
      }
    }
    let stateId = state.state_id;
    if (stateId) {
      const existingStateId = state.state_id!;

      let nodeX: number | null | undefined;
      if (!Object.prototype.hasOwnProperty.call(state, 'node_x')) {
        nodeX = undefined;
      } else {
        nodeX = state.node_x ?? null;
      }

      let nodeY: number | null | undefined;
      if (!Object.prototype.hasOwnProperty.call(state, 'node_y')) {
        nodeY = undefined;
      } else {
        nodeY = state.node_y ?? null;
      }

      await buildDynamicUpdate(
        client, "states", "id", existingStateId,
        {
          stm_name, state_name: state.state_name, vast_state_id: vastStateId,
          eks_condition_estimate: state.eks_condition_estimate,
          condition_lower: state.condition_lower, condition_upper: state.condition_upper,
          ellictation_type: elicitType, node_x: nodeX, node_y: nodeY,
        }
      );

    } else {
      const stateResult = await client.query(
        `INSERT INTO states (
          stm_name, state_name, vast_state_id, eks_condition_estimate,
          condition_lower, condition_upper, ellictation_type,
          node_x, node_y
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id`,
        [
          stm_name, state.state_name, vastStateId, state.eks_condition_estimate,
          state.condition_lower, state.condition_upper, elicitType,
          state.node_x ?? null, state.node_y ?? null,
        ]
      );
      stateId = stateResult.rows[0]?.id;

      if (stateId == null) {
        throw new Error("Upsert state failed: no id returned from database");
      }
    }

    if (state.frontend_state_id != null) {
      stateMap[state.frontend_state_id] = stateId;
    } else {
      stateMap[stateId] = stateId;
    }

    if (state.attributes && Array.isArray(state.attributes)) {
      for (const attr of state.attributes) {
        if (attr.state_attribute_id) {
          await buildDynamicUpdate(
            client, "state_attributes", "id", attr.state_attribute_id,
            { state_id: stateId, attribute_type: attr.attribute_type, value: attr.value, units: attr.units }
          );
        } else {
          await client.query(
            `INSERT INTO state_attributes (state_id, attribute_type, value, units)
              VALUES ($1, $2, $3, $4)`,
            [stateId, attr.attribute_type, attr.value, attr.units]
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
    let transitionId = transition.id;

    const startStateId = stateMap[transition.start_state_id] ? stateMap[transition.start_state_id] : transition.start_state_id;
    const endStateId = stateMap[transition.end_state_id] ? stateMap[transition.end_state_id] : transition.end_state_id;

    const hasOwn = (key: string) => Object.prototype.hasOwnProperty.call(transition, key);
    const anyDeltaInputProvided =
      hasOwn('likelihood_25') || hasOwn('likelihood_100') || hasOwn('time_25') || hasOwn('time_100');

    const time100 = transition.time_100 ?? null;
    const time25 = transition.time_25 ?? null;
    const likelihood25 = transition.likelihood_25 ?? null;
    const likelihood100 = transition.likelihood_100 ?? null;

    const computedDelta = calcTransitionDelta(likelihood25, likelihood100, time25, time100);

    if (transitionId) {
      let computedDeltaForUpdate: number | null = null;
      if (anyDeltaInputProvided) {
        const existingRes = await client.query<{
          time_25: number | null; time_100: number | null;
          likelihood_25: number | null; likelihood_100: number | null;
        }>(
          `SELECT time_25, time_100, likelihood_25, likelihood_100 FROM transitions WHERE id = $1`,
          [transitionId]
        );
        if (existingRes.rows.length === 0) {
          throw { status: 404, message: `transitions with id=${transitionId} not found` };
        }

        const existing = existingRes.rows[0];
        const mergedTime25 = hasOwn('time_25') ? (transition.time_25 ?? null) : (existing.time_25 ?? null);
        const mergedTime100 = hasOwn('time_100') ? (transition.time_100 ?? null) : (existing.time_100 ?? null);
        const mergedLikelihood25 = hasOwn('likelihood_25') ? (transition.likelihood_25 ?? null) : (existing.likelihood_25 ?? null);
        const mergedLikelihood100 = hasOwn('likelihood_100') ? (transition.likelihood_100 ?? null) : (existing.likelihood_100 ?? null);

        computedDeltaForUpdate = calcTransitionDelta(mergedLikelihood25, mergedLikelihood100, mergedTime25, mergedTime100);
      }

      await buildDynamicUpdate(
        client, "transitions", "id", transitionId,
        {
          stm_name, start_state_id: startStateId, end_state_id: endStateId,
          transition_id: transition.transition_id,
          time_100: transition.time_100, time_25: transition.time_25,
          likelihood_25: transition.likelihood_25, likelihood_100: transition.likelihood_100,
          transition_delta: anyDeltaInputProvided ? computedDeltaForUpdate : undefined,
        }
      );

    } else {
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
            [stm_name, startStateId, endStateId, transition.transition_id, time100, time25, likelihood25, likelihood100, computedDelta]
          )
        : await client.query(
            `INSERT INTO transitions (
              stm_name, start_state_id, end_state_id, transition_id,
              time_100, time_25, likelihood_25, likelihood_100, transition_delta
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id`,
            [stm_name, startStateId, endStateId, transition.transition_id, time100, time25, likelihood25, likelihood100, computedDelta]
          );

      transitionId = transitionResult.rows[0].id;
      if (typeof transitionId === 'number') transitionIds.push(transitionId);
    }

    for (const chain of transition.causal_chain || []) {
      let chainId = chain.causal_chain_id;
      const chainPartMap: Record<string, string> = {
        "management intervention": "Management Intervention",
        "favorable abiotic factor": "Favorable abiotic factor",
        "favourable abiotic factor": "Favorable abiotic factor",
        "biotic process": "Biotic process",
        "hazard": "Hazard",
      };
      let chainPart: string | null | undefined;
      if (!('chain_part' in chain)) {
        chainPart = undefined;
      } else if (chain.chain_part === null) {
        chainPart = null;
      } else if (typeof chain.chain_part === 'string' && chain.chain_part.trim() !== '') {
        const mapped = chainPartMap[chain.chain_part.toLowerCase()];
        if (!mapped) throw new Error(`Invalid chain_part: ${chain.chain_part}`);
        chainPart = mapped;
      } else {
        chainPart = null;
      }

      if (chainId) {
        await buildDynamicUpdate(
          client, "causal_chain", "id", chainId,
          { transition_id: transitionId, name: chain.name, chain_part: chainPart }
        );
      } else {
        const chainResult = await client.query(
          `INSERT INTO causal_chain (transition_id, name, chain_part) VALUES ($1, $2, $3) RETURNING id`,
          [transitionId, chain.name, chainPart]
        );
        chainId = chainResult.rows[0]?.id;
      }

      const driverIds: number[] = [];
      for (const driver of chain.drivers || []) {
        let driverId = driver.driver_id;
        if (driverId) {
          await buildDynamicUpdate(
            client, "drivers", "id", driverId,
            { driver: driver.driver, description: driver.description, driver_group: driver.driver_group }
          );
        } else {
          const driverResult = await client.query(
            `INSERT INTO drivers (driver, description, driver_group) VALUES ($1, $2, $3) RETURNING id`,
            [driver.driver, driver.description, driver.driver_group]
          );
          driverId = driverResult.rows[0].id;
          if (typeof driverId === 'number') driverIds.push(driverId);
        }

        let chain_driver_Id: number | null = null;
        const chainDriverRes = await client.query(
          `SELECT id FROM chain_driver WHERE causal_chain_id = $1 and driver_id = $2`,
          [chainId, driverId]
        );
        if (chainDriverRes && Array.isArray(chainDriverRes.rows) && chainDriverRes.rows.length > 0) {
          chain_driver_Id = chainDriverRes.rows[0].id;
        } else {
          chain_driver_Id = null;
        }

        if (!chain_driver_Id) {
          await client.query(
            `INSERT INTO chain_driver (causal_chain_id, driver_id) VALUES ($1, $2) RETURNING id`,
            [chainId, driverId]
          );
        }
      }
    }
  }

  return transitionIds;
}

// Save a new model or update an existing one.
// creatorEmail is required for new models (auto-grants owner row); ignored for updates.
export async function saveModel(modelData: BMRGData, creatorEmail?: string) {
  if (!modelData.id) {
    // Guard before any DB interaction: protect reserved template names.
    const stmNameToCheck = typeof modelData.stm_name === 'string' ? modelData.stm_name.trim() : '';
    if (PROTECTED_TEMPLATE_NAMES.includes(stmNameToCheck)) {
      throw new ConflictError('This name is reserved for a system template and cannot be used');
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let stmName = typeof modelData.stm_name === 'string' ? modelData.stm_name.trim() : '';
    if (modelData.id) {
      const existingName = await assertModelUnlockedById(modelData.id, client);
      if (!stmName && existingName) {
        stmName = existingName;
      }
    } else if (stmName) {
      await assertModelUnlocked(stmName, client);
    }

    const isNewModel = !modelData.id;

    // 1. Upsert main model
    const modelId = await upsertModelMetadata(client, modelData, isNewModel ? creatorEmail : undefined);

    if (!stmName) {
      const res = await client.query(
        `SELECT stm_name FROM stmmodel WHERE id = $1`,
        [modelId]
      );
      if (res.rows.length > 0) {
        stmName = res.rows[0].stm_name;
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
      stateMap = await upsertStates(client, stmName, modelData.states);
    }
    // 4. Upsert transitions & causal_chain & drivers
    if (modelData.transitions != undefined && modelData.transitions != null) {
      await upsertTransitions(client, stmName, modelData.transitions, stateMap);
    }

    // 5. Auto-grant owner row on new model creation (inside the same transaction).
    if (isNewModel && creatorEmail) {
      await client.query(
        `INSERT INTO model_permissions (stm_name, user_email, role, granted_by, granted_at)
         VALUES ($1, $2, 'owner', $2, NOW())
         ON CONFLICT (stm_name, user_email) DO NOTHING`,
        [stmName, creatorEmail]
      );
    }

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

// Flag/unflag a model as a template (Admin or model owner only).
// @deprecated — PATCH /models/:name/template route has been removed.
export async function flagAsTemplate(stmName: string, flag: boolean, userRole: string, userEmail: string): Promise<void> {
  const client = await pool.connect();
  try {
    if (userRole !== 'Admin') {
      const ownerRes = await client.query(
        `SELECT c.id, LOWER(c.email) AS email
         FROM contributors c
         JOIN model_contributions mc ON c.id = mc.contributor_id
         JOIN stmmodel sm ON sm.id = mc.stm_id
         WHERE sm.stm_name = $1`,
        [stmName]
      );
      const isOwner = ownerRes.rows.some((row: { email: string }) => row.email === userEmail.toLowerCase());
      if (!isOwner) {
        throw { status: 403, message: 'Admin or owner required to update template flag' };
      }
    }

    const result = await client.query(
      `UPDATE stmmodel SET is_template = $1 WHERE stm_name = $2 RETURNING id`,
      [flag, stmName]
    );

    if (result.rows.length === 0) {
      throw { status: 404, message: `Model with name '${stmName}' not found` };
    }
  } finally {
    client.release();
  }
}

// Clone a template into a new model owned by the requesting user.
export async function cloneFromTemplate(
  templateName: string,
  newModelName: string,
  contributorId: number | null,
  userEmail?: string,
): Promise<{ modelId: number; stm_name: string }> {
  // Guard before any DB interaction: protect reserved template names for new model name.
  if (PROTECTED_TEMPLATE_NAMES.includes(newModelName.trim())) {
    throw new ConflictError('This name is reserved for a system template and cannot be used');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Fetch the template model (must be flagged as a template)
    const templateRes = await client.query(
      `SELECT id, stm_name, version, release_date, authorised_by, region, region_id,
              ecosystem_type, aus_eco_archetype_code, aus_eco_archetype_name,
              aus_eco_umbrella_code, peer_reviewed, no_peer_reviewers, climate
       FROM stmmodel WHERE stm_name = $1 AND is_template = TRUE`,
      [templateName]
    );

    if (templateRes.rows.length === 0) {
      throw { status: 404, message: `Template with name '${templateName}' not found` };
    }

    const template = templateRes.rows[0];

    // 1.1 Validate region_id if present
    const regionCheck = await client.query('SELECT id FROM regions WHERE id = $1', [template.region_id]);
    if (template.region_id && regionCheck.rows.length === 0) {
      throw { status: 400, message: `Invalid region_id ${template.region_id}` };
    }

    // 2. Create a new model with the same metadata but new name and is_template = false
    const newModelRes = await client.query(
      `INSERT INTO stmmodel (
         stm_name, version, release_date, authorised_by, region, region_id,
         ecosystem_type, aus_eco_archetype_code, aus_eco_archetype_name,
         aus_eco_umbrella_code, peer_reviewed, no_peer_reviewers, climate, is_template
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, FALSE)
       RETURNING id`,
      [
        newModelName, template.version, template.release_date, userEmail ?? template.authorised_by,
        template.region, template.region_id, template.ecosystem_type,
        template.aus_eco_archetype_code, template.aus_eco_archetype_name,
        template.aus_eco_umbrella_code, template.peer_reviewed, template.no_peer_reviewers,
        template.climate
      ]
    );

    const newModelId = newModelRes.rows[0].id;

    // 2.1 Link the cloning user as the owner of the new model.
    let resolvedContributorId = contributorId;
    if (resolvedContributorId === null && userEmail) {
      const email = userEmail.trim().toLowerCase();
      const { rows: found } = await client.query(
        `SELECT id FROM contributors WHERE LOWER(email) = $1 LIMIT 1`,
        [email]
      );
      if (found.length) {
        resolvedContributorId = found[0].id;
      } else {
        const { rows: inserted } = await client.query(
          `INSERT INTO contributors (name, email) VALUES (NULL, $1) RETURNING id`,
          [email]
        );
        resolvedContributorId = inserted[0].id;
      }
    }

    if (resolvedContributorId !== null) {
      await client.query(
        `INSERT INTO model_contributions (stm_id, contributor_id, contribution_type) VALUES ($1, $2, 'Author')`,
        [newModelId, resolvedContributorId]
      );
    }

    // 3. Copy all states
    const statesRes = await client.query(
      `SELECT id, state_name, vast_state_id, eks_condition_estimate, condition_lower,
              condition_upper, ellictation_type, node_x, node_y
       FROM states WHERE stm_name = $1`,
      [templateName]
    );

    const stateMap: Record<number, number> = {};

    if (statesRes.rows.length > 0) {
      const bulkStateRes = await client.query(
        `INSERT INTO states (
           stm_name, state_name, vast_state_id, eks_condition_estimate,
           condition_lower, condition_upper, ellictation_type, node_x, node_y
         )
         SELECT $1,
                u.state_name, u.vast_state_id, u.eks_condition_estimate,
                u.condition_lower, u.condition_upper, u.ellictation_type, u.node_x, u.node_y
         FROM unnest(
           $2::text[], $3::int[], $4::numeric[], $5::numeric[], $6::numeric[],
           $7::text[], $8::numeric[], $9::numeric[]
         ) AS u(state_name, vast_state_id, eks_condition_estimate,
                condition_lower, condition_upper, ellictation_type, node_x, node_y)
         RETURNING id`,
        [
          newModelName,
          statesRes.rows.map(s => s.state_name),
          statesRes.rows.map(s => s.vast_state_id),
          statesRes.rows.map(s => s.eks_condition_estimate),
          statesRes.rows.map(s => s.condition_lower),
          statesRes.rows.map(s => s.condition_upper),
          statesRes.rows.map(s => s.ellictation_type),
          statesRes.rows.map(s => s.node_x),
          statesRes.rows.map(s => s.node_y),
        ]
      );
      for (let i = 0; i < statesRes.rows.length; i++) {
        stateMap[statesRes.rows[i].id] = bulkStateRes.rows[i].id;
      }
    }

    // 4. Copy all transitions
    const transitionsRes = await client.query(
      `SELECT id, start_state_id, end_state_id, time_25, time_100,
              likelihood_25, likelihood_100, transition_delta
       FROM transitions WHERE stm_name = $1`,
      [templateName]
    );

    const transitionIdMap: Record<number, number> = {};

    if (transitionsRes.rows.length > 0) {
      for (const trans of transitionsRes.rows) {
        if (!stateMap[trans.start_state_id] || !stateMap[trans.end_state_id]) {
          throw { status: 500, message: `State mapping missing for transition id=${trans.id} in template '${templateName}'` };
        }
      }

      const bulkTransRes = await client.query(
        `INSERT INTO transitions (
           stm_name, start_state_id, end_state_id, time_25, time_100,
           likelihood_25, likelihood_100, transition_delta
         )
         SELECT $1,
                u.start_state_id, u.end_state_id, u.time_25, u.time_100,
                u.likelihood_25, u.likelihood_100, u.transition_delta
         FROM unnest(
           $2::int[], $3::int[], $4::numeric[], $5::numeric[], $6::numeric[], $7::numeric[], $8::numeric[]
         ) AS u(start_state_id, end_state_id, time_25, time_100, likelihood_25, likelihood_100, transition_delta)
         RETURNING id`,
        [
          newModelName,
          transitionsRes.rows.map(t => stateMap[t.start_state_id]),
          transitionsRes.rows.map(t => stateMap[t.end_state_id]),
          transitionsRes.rows.map(t => t.time_25),
          transitionsRes.rows.map(t => t.time_100),
          transitionsRes.rows.map(t => t.likelihood_25),
          transitionsRes.rows.map(t => t.likelihood_100),
          transitionsRes.rows.map(t => t.transition_delta),
        ]
      );

      for (let i = 0; i < transitionsRes.rows.length; i++) {
        transitionIdMap[transitionsRes.rows[i].id] = bulkTransRes.rows[i].id;
      }
    }

    // 4.1 Copy causal chains and drivers per transition
    for (const trans of transitionsRes.rows) {
      const newTransId = transitionIdMap[trans.id];
      const chainsRes = await client.query(
        `SELECT id, name, chain_part FROM causal_chain WHERE transition_id = $1`,
        [trans.id]
      );

      for (const chain of chainsRes.rows) {
        const newChainRes = await client.query(
          `INSERT INTO causal_chain (transition_id, name, chain_part) VALUES ($1, $2, $3) RETURNING id`,
          [newTransId, chain.name, chain.chain_part]
        );
        const newChainId = newChainRes.rows[0].id;

        const driversRes = await client.query(
          `SELECT driver_id FROM chain_driver WHERE causal_chain_id = $1`,
          [chain.id]
        );

        for (const driver of driversRes.rows) {
          await client.query(
            `INSERT INTO chain_driver (causal_chain_id, driver_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [newChainId, driver.driver_id]
          );
        }
      }
    }

    // 5. Auto-grant owner row for the cloning user (inside the same transaction).
    if (userEmail) {
      await client.query(
        `INSERT INTO model_permissions (stm_name, user_email, role, granted_by, granted_at)
         VALUES ($1, $2, 'owner', $2, NOW())
         ON CONFLICT (stm_name, user_email) DO NOTHING`,
        [newModelName, userEmail]
      );
    }

    await client.query('COMMIT');
    return { modelId: newModelId, stm_name: newModelName };

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
