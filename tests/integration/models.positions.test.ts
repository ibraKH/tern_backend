import request from 'supertest';

jest.mock('../../src/utils/jwt', () => ({
  __esModule: true,
  verifyToken: jest.fn(),
}));

// We mock the DB layer but keep the HTTP stack (Express + router + middleware)
// so this remains an integration-style test for save->reload behavior.
jest.mock('../../src/config/database', () => {
  const store: {
    modelId: number;
    stmName: string;
    states: Array<{ id: number; state_name: string; node_x: number | null; node_y: number | null }>;
  } = {
    modelId: 42,
    stmName: 'PosModel',
    states: [],
  };

  let nextStateId = 100;

  const resetStore = () => {
    store.modelId = 42;
    store.stmName = 'PosModel';
    store.states.length = 0;
    nextStateId = 100;
  };

  const client = {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      const text = String(sql);

      // Transaction wrappers
      if (text.startsWith('BEGIN') || text.startsWith('COMMIT') || text.startsWith('ROLLBACK')) {
        return { rows: [] };
      }

      // --- Save flow ---
      if (text.includes('INSERT INTO stmmodel')) {
        store.stmName = String(params?.[0] ?? store.stmName);
        return { rows: [{ id: store.modelId }] };
      }

      if (text.includes('SELECT id FROM regions')) {
        return { rows: [{ id: params?.[0] ?? 1 }] };
      }

      if (text.includes('INSERT INTO vast_states')) {
        return { rows: [{ id: 500 }] };
      }

      if (text.includes('INSERT INTO states')) {
        // Expected params order in save.service.ts:
        // [stm_name, state_name, vastStateId, eks_condition_estimate, condition_lower, condition_upper, elicitType, node_x, node_y]
        const stateRow = {
          id: nextStateId++,
          state_name: String(params?.[1] ?? 'State'),
          node_x: (params?.[7] as number | null) ?? null,
          node_y: (params?.[8] as number | null) ?? null,
        };
        store.states.push(stateRow);
        return { rows: [{ id: stateRow.id }] };
      }

      if (text.includes('INSERT INTO state_attributes')) {
        return { rows: [{ id: 900 }] };
      }

      // Transitions are not relevant for this test.
      if (text.includes('INSERT INTO transitions')) {
        return { rows: [{ id: 700 }] };
      }

      if (text.includes('INSERT INTO causal_chain') || text.includes('INSERT INTO drivers') || text.includes('INSERT INTO chain_driver')) {
        return { rows: [{ id: 701 }] };
      }

      if (text.includes('SELECT id FROM chain_driver')) {
        return { rows: [] };
      }

      // Activity logger is fire-and-forget; keep it harmless.
      if (text.includes('SELECT id FROM stmmodel WHERE stm_name')) {
        return { rows: [{ id: store.modelId }] };
      }
      if (text.includes('INSERT INTO collab_activity')) {
        return { rows: [] };
      }

      // --- Load flow (show.service.ts) ---
      if (text.includes('FROM stmmodel') && text.includes('WHERE stm_name = $1')) {
        return {
          rows: [
            {
              id: store.modelId,
              stm_name: store.stmName,
              version: 'v1',
              release_date: '2026-01-01',
              authorised_by: 'A',
              region: 'R',
              region_id: 1,
              ecosystem_type: 'E',
              aus_eco_archetype_code: '1',
              aus_eco_archetype_name: 'Arc',
              aus_eco_umbrella_code: '1',
              peer_reviewed: 'No',
              no_peer_reviewers: 0,
              climate: 'C',
            },
          ],
        };
      }

      if (text.includes('FROM model_contributions')) {
        return { rows: [] };
      }

      if (text.includes('FROM states s') && text.includes('LEFT JOIN vast_states')) {
        return {
          rows: store.states.map((s) => ({
            id: s.id,
            state_name: s.state_name,
            eks_condition_estimate: null,
            condition_lower: null,
            condition_upper: null,
            ellictation_type: null,
            node_x: s.node_x,
            node_y: s.node_y,
            vast_state_id: null,
            vast_id: null,
            vast_class: null,
            vast_name: null,
            eks_overstorey_class: null,
            eks_understorey_class: null,
            eks_substate: null,
            link: null,
          })),
        };
      }

      if (text.includes('FROM state_attributes')) {
        return { rows: [] };
      }

      if (text.includes('FROM transitions t')) {
        return { rows: [] };
      }

      if (text.includes('FROM method_alignment')) {
        return { rows: [] };
      }

      return { rows: [] };
    }),
    release: jest.fn(),
  };

  const pool = {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      const text = String(sql);
      // Auth middleware lookup
      if (text.includes('FROM auth_users') && text.includes('WHERE id = $1')) {
        return { rows: [{ id: 1, email: 'admin@admin.com', role: 'Editor', contributor_id: null }] };
      }
      // Activity logger model lookup (also OK here)
      if (text.includes('SELECT id FROM stmmodel WHERE stm_name')) {
        return { rows: [{ id: store.modelId }] };
      }
      return client.query(sql, params);
    }),
    connect: jest.fn(async () => client),
    // Expose for debugging if needed
    _store: store,
    _client: client,
    _resetMockStore: resetStore,
  };

  return { __esModule: true, default: pool };
});

import app from '../../src/app';
import pool from '../../src/config/database';
import { verifyToken } from '../../src/utils/jwt';

describe('Model node positions persistence', () => {
  beforeEach(() => {
    // ensure test isolation for future additional cases
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (pool as any)?._resetMockStore?.();
    jest.clearAllMocks();
    (verifyToken as jest.Mock).mockReturnValue({ uid: 1, email: 'admin@admin.com', role: 'Editor' });
  });

  it('POST /models/save then GET /models/:name returns node_x/node_y', async () => {
    const payload = {
      stm_name: 'PosModel',
      version: 'v1',
      release_date: '2026-01-01',
      authorised_by: 'A',
      region: 'R',
      region_id: 1,
      climate: 'C',
      ecosystem_type: 'E',
      aus_eco_archetype_code: 1,
      aus_eco_archetype_name: 'Arc',
      aus_eco_umbrella_code: 1,
      peer_reviewed: 'No',
      no_peer_reviewers: 0,
      contributing_experts: [],
      states: [
        {
          state_name: 'State A',
          vast_state: {},
          condition_upper: null,
          condition_lower: null,
          eks_condition_estimate: null,
          node_x: 123.45,
          node_y: 678.9,
          attributes: [],
        },
      ],
      transitions: [],
    };

    const saveRes = await request(app)
      .post('/models/save')
      .set('Authorization', 'Bearer any-token')
      .send(payload);

    expect(saveRes.status).toBe(201);
    expect(saveRes.body).toMatchObject({ success: true });

    const getRes = await request(app)
      .get('/models/PosModel')
      .set('Authorization', 'Bearer any-token');

    expect(getRes.status).toBe(200);
    expect(getRes.body?.states).toHaveLength(1);
    expect(getRes.body.states[0]).toMatchObject({
      state_name: 'State A',
      node_x: 123.45,
      node_y: 678.9,
    });
  });
});
