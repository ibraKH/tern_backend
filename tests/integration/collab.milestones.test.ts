// Mocks must be declared before imports.
jest.mock('../../src/config/database', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

jest.mock('../../src/utils/jwt', () => ({
  __esModule: true,
  verifyToken: jest.fn(),
  signToken: jest.fn((p: { uid: number }) => `mock-token-${p.uid}`),
}));

jest.mock('../../src/services/collab/milestones.service');
jest.mock('../../src/services/models/save.service');
jest.mock('../../src/services/collab/activity.service', () => ({
  logActivity: jest.fn().mockResolvedValue(undefined),
  getRecentActivity: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../src/socket', () => ({
  __esModule: true,
  io: { to: jest.fn() },
  initIo: jest.fn(),
  getIo: jest.fn(),
}));
jest.mock('../../src/collab/roomManager', () => ({
  broadcastActivity: jest.fn(),
  joinRoom: jest.fn().mockResolvedValue({}),
  leaveRoom: jest.fn().mockResolvedValue(null),
  getRoom: jest.fn().mockReturnValue(null),
  getUserColor: jest.fn().mockReturnValue('#999'),
}));

import request from 'supertest';

import app from '../../src/app';
import pool from '../../src/config/database';
import { verifyToken } from '../../src/utils/jwt';
import { io } from '../../src/socket';
import * as milestonesService from '../../src/services/collab/milestones.service';
import * as saveService from '../../src/services/models/save.service';

const mockQuery = pool.query as jest.Mock;
const mockVerifyToken = verifyToken as jest.Mock;
const mockIoTo = io.to as jest.Mock;
const mockCreateMilestone = milestonesService.createMilestone as jest.Mock;
const mockListMilestones = milestonesService.listMilestones as jest.Mock;
const mockGetMilestone = milestonesService.getMilestone as jest.Mock;
const mockDeleteMilestone = milestonesService.deleteMilestone as jest.Mock;
const mockSaveModel = saveService.saveModel as jest.Mock;

const MODEL = 'TestModel';

type Role = 'Admin' | 'Editor' | 'Viewer';

function setupAuth(role: Role) {
  const uid = role === 'Admin' ? 1 : role === 'Editor' ? 2 : 3;
  mockVerifyToken.mockReturnValue({ uid, email: `${role.toLowerCase()}@t.com`, role });
  mockQuery.mockResolvedValueOnce({
    rows: [{ id: uid, email: `${role.toLowerCase()}@t.com`, role, contributor_id: null }],
  });
}

function authHeader(role: Role) {
  const uid = role === 'Admin' ? 1 : role === 'Editor' ? 2 : 3;
  return `Bearer mock-token-${uid}`;
}

const SAMPLE_MILESTONE = {
  id: 1, label: 'v1', createdBy: 1, createdByEmail: 'admin@t.com', createdAt: '2026-04-01T00:00:00Z',
};
const SAMPLE_MILESTONE_WITH_SNAPSHOT = {
  ...SAMPLE_MILESTONE,
  snapshot: { stm_name: MODEL, states: [{ state_id: 1 }], transitions: [] },
};

beforeEach(() => {
  const mockEmit = jest.fn();
  mockIoTo.mockReturnValue({ emit: mockEmit });
  mockSaveModel.mockResolvedValue(undefined);
});

// ── Issue #46: Milestones REST API ────────────────────────────────────────────

describe('GET /collab/:modelName/milestones — list (#46)', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get(`/collab/${MODEL}/milestones`);
    expect(res.status).toBe(401);
  });

  it('returns 200 with milestones array for any authenticated role', async () => {
    setupAuth('Viewer');
    mockListMilestones.mockResolvedValueOnce([SAMPLE_MILESTONE]);

    const res = await request(app)
      .get(`/collab/${MODEL}/milestones`)
      .set('Authorization', authHeader('Viewer'));

    expect(res.status).toBe(200);
    expect(res.body.milestones).toHaveLength(1);
    expect(res.body.milestones[0]).toMatchObject({ id: 1, label: 'v1' });
  });

  it('never returns snapshot_data in the list response', async () => {
    setupAuth('Editor');
    mockListMilestones.mockResolvedValueOnce([SAMPLE_MILESTONE]);

    const res = await request(app)
      .get(`/collab/${MODEL}/milestones`)
      .set('Authorization', authHeader('Editor'));

    expect(res.status).toBe(200);
    res.body.milestones.forEach((m: object) => {
      expect(m).not.toHaveProperty('snapshot');
    });
  });
});

describe('POST /collab/:modelName/milestones — create (#46 + #47)', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).post(`/collab/${MODEL}/milestones`).send({ label: 'v1' });
    expect(res.status).toBe(401);
  });

  it('returns 403 when Viewer tries to create a milestone', async () => {
    setupAuth('Viewer');

    const res = await request(app)
      .post(`/collab/${MODEL}/milestones`)
      .set('Authorization', authHeader('Viewer'))
      .send({ label: 'v1' });

    expect(res.status).toBe(403);
  });

  it('returns 400 when label is missing', async () => {
    setupAuth('Admin');

    const res = await request(app)
      .post(`/collab/${MODEL}/milestones`)
      .set('Authorization', authHeader('Admin'))
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/label/i);
  });

  it('returns 400 when label exceeds 100 characters', async () => {
    setupAuth('Editor');

    const res = await request(app)
      .post(`/collab/${MODEL}/milestones`)
      .set('Authorization', authHeader('Editor'))
      .send({ label: 'x'.repeat(101) });

    expect(res.status).toBe(400);
  });

  it('returns 201 with milestone metadata (no snapshot) for Admin', async () => {
    setupAuth('Admin');
    mockCreateMilestone.mockResolvedValueOnce(SAMPLE_MILESTONE);

    const res = await request(app)
      .post(`/collab/${MODEL}/milestones`)
      .set('Authorization', authHeader('Admin'))
      .send({ label: 'v1' });

    expect(res.status).toBe(201);
    expect(res.body.milestone).toMatchObject({ id: 1, label: 'v1' });
    expect(res.body.milestone).not.toHaveProperty('snapshot');
  });

  it('returns 201 for Editor role', async () => {
    setupAuth('Editor');
    mockCreateMilestone.mockResolvedValueOnce(SAMPLE_MILESTONE);

    const res = await request(app)
      .post(`/collab/${MODEL}/milestones`)
      .set('Authorization', authHeader('Editor'))
      .send({ label: 'v1' });

    expect(res.status).toBe(201);
  });

  it('emits milestone:created socket event to the model room (#47)', async () => {
    setupAuth('Admin');
    mockCreateMilestone.mockResolvedValueOnce(SAMPLE_MILESTONE);

    const mockEmit = jest.fn();
    mockIoTo.mockReturnValue({ emit: mockEmit });

    await request(app)
      .post(`/collab/${MODEL}/milestones`)
      .set('Authorization', authHeader('Admin'))
      .send({ label: 'v1' });

    expect(mockIoTo).toHaveBeenCalledWith(`name:${MODEL}`);
    expect(mockEmit).toHaveBeenCalledWith('milestone:created', expect.objectContaining({ id: 1, label: 'v1' }));
  });
});

describe('GET /collab/:modelName/milestones/:id — single (#46)', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get(`/collab/${MODEL}/milestones/1`);
    expect(res.status).toBe(401);
  });

  it('returns 200 with full snapshot for Viewer', async () => {
    setupAuth('Viewer');
    mockGetMilestone.mockResolvedValueOnce(SAMPLE_MILESTONE_WITH_SNAPSHOT);

    const res = await request(app)
      .get(`/collab/${MODEL}/milestones/1`)
      .set('Authorization', authHeader('Viewer'));

    expect(res.status).toBe(200);
    expect(res.body.milestone).toHaveProperty('snapshot');
    expect(res.body.milestone.snapshot).toMatchObject({ stm_name: MODEL });
  });

  it('returns 404 when milestone does not exist', async () => {
    setupAuth('Admin');
    mockGetMilestone.mockResolvedValueOnce(null);

    const res = await request(app)
      .get(`/collab/${MODEL}/milestones/999`)
      .set('Authorization', authHeader('Admin'));

    expect(res.status).toBe(404);
  });
});

describe('DELETE /collab/:modelName/milestones/:id — delete (#46)', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).delete(`/collab/${MODEL}/milestones/1`);
    expect(res.status).toBe(401);
  });

  it('returns 403 for Viewer role', async () => {
    setupAuth('Viewer');

    const res = await request(app)
      .delete(`/collab/${MODEL}/milestones/1`)
      .set('Authorization', authHeader('Viewer'));

    expect(res.status).toBe(403);
  });

  it('returns 403 for Editor role', async () => {
    setupAuth('Editor');

    const res = await request(app)
      .delete(`/collab/${MODEL}/milestones/1`)
      .set('Authorization', authHeader('Editor'));

    expect(res.status).toBe(403);
  });

  it('returns 200 when Admin deletes an existing milestone', async () => {
    setupAuth('Admin');
    mockDeleteMilestone.mockResolvedValueOnce(true);

    const res = await request(app)
      .delete(`/collab/${MODEL}/milestones/1`)
      .set('Authorization', authHeader('Admin'));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 404 when milestone does not exist', async () => {
    setupAuth('Admin');
    mockDeleteMilestone.mockResolvedValueOnce(false);

    const res = await request(app)
      .delete(`/collab/${MODEL}/milestones/999`)
      .set('Authorization', authHeader('Admin'));

    expect(res.status).toBe(404);
  });
});

// ── Issue #47: Restore endpoint ───────────────────────────────────────────────

describe('POST /collab/:modelName/milestones/:id/restore — restore (#47)', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).post(`/collab/${MODEL}/milestones/1/restore`);
    expect(res.status).toBe(401);
  });

  it('returns 403 for Viewer role', async () => {
    setupAuth('Viewer');

    const res = await request(app)
      .post(`/collab/${MODEL}/milestones/1/restore`)
      .set('Authorization', authHeader('Viewer'));

    expect(res.status).toBe(403);
  });

  it('returns 404 when milestone does not exist', async () => {
    setupAuth('Admin');
    mockGetMilestone.mockResolvedValueOnce(null);

    const res = await request(app)
      .post(`/collab/${MODEL}/milestones/999/restore`)
      .set('Authorization', authHeader('Admin'));

    expect(res.status).toBe(404);
  });

  it('calls saveModel with the snapshot data and returns 200', async () => {
    setupAuth('Admin');
    mockGetMilestone.mockResolvedValueOnce(SAMPLE_MILESTONE_WITH_SNAPSHOT);

    const res = await request(app)
      .post(`/collab/${MODEL}/milestones/1/restore`)
      .set('Authorization', authHeader('Admin'));

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Model restored');
    expect(mockSaveModel).toHaveBeenCalledWith(SAMPLE_MILESTONE_WITH_SNAPSHOT.snapshot);
  });

  it('broadcasts model:restored socket event to the room', async () => {
    setupAuth('Editor');
    mockGetMilestone.mockResolvedValueOnce(SAMPLE_MILESTONE_WITH_SNAPSHOT);

    const mockEmit = jest.fn();
    mockIoTo.mockReturnValue({ emit: mockEmit });

    await request(app)
      .post(`/collab/${MODEL}/milestones/1/restore`)
      .set('Authorization', authHeader('Editor'));

    expect(mockIoTo).toHaveBeenCalledWith(`name:${MODEL}`);
    expect(mockEmit).toHaveBeenCalledWith(
      'model:restored',
      expect.objectContaining({ milestoneId: 1, label: 'v1' }),
    );
  });

  it('Editor role can also restore (only Viewer is blocked)', async () => {
    setupAuth('Editor');
    mockGetMilestone.mockResolvedValueOnce(SAMPLE_MILESTONE_WITH_SNAPSHOT);

    const res = await request(app)
      .post(`/collab/${MODEL}/milestones/1/restore`)
      .set('Authorization', authHeader('Editor'));

    expect(res.status).toBe(200);
  });
});
