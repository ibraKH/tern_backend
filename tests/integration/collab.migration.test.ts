import { execSync } from 'child_process';
import pool from '../../src/config/database';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function tableExists(tableName: string): Promise<boolean> {
  const res = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1`,
    [tableName],
  );
  return res.rowCount !== null && res.rowCount > 0;
}

async function columnInfo(
  tableName: string,
  columnName: string,
): Promise<{ data_type: string; is_nullable: string } | null> {
  const res = await pool.query(
    `SELECT data_type, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = $1
       AND column_name  = $2`,
    [tableName, columnName],
  );
  return res.rows[0] ?? null;
}

async function indexExists(indexName: string): Promise<boolean> {
  const res = await pool.query(
    `SELECT indexname FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = $1`,
    [indexName],
  );
  return res.rowCount !== null && res.rowCount > 0;
}

async function uniqueConstraintExists(
  tableName: string,
  constraintName: string,
): Promise<boolean> {
  const res = await pool.query(
    `SELECT constraint_name
     FROM information_schema.table_constraints
     WHERE table_schema     = 'public'
       AND table_name       = $1
       AND constraint_name  = $2
       AND constraint_type  = 'UNIQUE'`,
    [tableName, constraintName],
  );
  return res.rowCount !== null && res.rowCount > 0;
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let testModelId: number;
let testUserId: number;
let testCommentId: number;

beforeAll(async () => {
  // Ensure migration is applied (idempotent — safe to run repeatedly)
  execSync('npm run migrate:up', { stdio: 'pipe' });

  // Shared model
  const modelRes = await pool.query<{ id: number }>(
    `INSERT INTO stmmodel(stm_name) VALUES($1) RETURNING id`,
    [`__test_collab_migration_${Date.now()}`],
  );
  testModelId = modelRes.rows[0].id;

  // Shared user
  const userRes = await pool.query<{ id: number }>(
    `INSERT INTO auth_users(email, password_hash) VALUES($1, $2) RETURNING id`,
    [`__testcollab_${Date.now()}@example.com`, 'placeholder_hash'],
  );
  testUserId = userRes.rows[0].id;

  // Shared comment (required by mention tests)
  const commentRes = await pool.query<{ id: number }>(
    `INSERT INTO collab_comments(model_id, user_id, body) VALUES($1, $2, $3) RETURNING id`,
    [testModelId, testUserId, 'migration test comment'],
  );
  testCommentId = commentRes.rows[0].id;
});

afterAll(async () => {
  // Deleting the model cascades to collab_activity/locks/comments/milestones.
  // Deleting comments cascades to collab_mentions.
  await pool.query('DELETE FROM stmmodel  WHERE id = $1', [testModelId]);
  await pool.query('DELETE FROM auth_users WHERE id = $1', [testUserId]);
  await pool.end();
});

// ===========================================================================
// 1. TABLE EXISTENCE
// ===========================================================================

describe('tables exist after migration', () => {
  const tables = [
    'collab_activity',
    'collab_locks',
    'collab_comments',
    'collab_milestones',
    'collab_mentions',
  ];

  test.each(tables)('%s exists', async (tbl) => {
    expect(await tableExists(tbl)).toBe(true);
  });
});

// ===========================================================================
// 2. COLUMN SHAPES
// ===========================================================================

describe('collab_activity columns', () => {
  const cases: [string, string, string][] = [
    ['id',          'integer',                  'NO'],
    ['model_id',    'integer',                  'NO'],
    ['user_id',     'integer',                  'NO'],
    ['action',      'character varying',        'NO'],
    ['entity_type', 'character varying',        'YES'],
    ['entity_id',   'integer',                  'YES'],
    ['detail',      'jsonb',                    'YES'],
    ['created_at',  'timestamp with time zone', 'NO'],
  ];

  test.each(cases)('column %s has type %s, nullable=%s', async (col, dtype, nullable) => {
    const info = await columnInfo('collab_activity', col);
    expect(info).not.toBeNull();
    expect(info!.data_type).toBe(dtype);
    expect(info!.is_nullable).toBe(nullable);
  });
});

describe('collab_locks columns', () => {
  const cases: [string, string, string][] = [
    ['id',          'integer',                  'NO'],
    ['model_id',    'integer',                  'NO'],
    ['user_id',     'integer',                  'NO'],
    ['entity_type', 'character varying',        'NO'],
    ['entity_id',   'integer',                  'NO'],
    ['locked_at',   'timestamp with time zone', 'NO'],
    ['expires_at',  'timestamp with time zone', 'NO'],
  ];

  test.each(cases)('column %s has type %s, nullable=%s', async (col, dtype, nullable) => {
    const info = await columnInfo('collab_locks', col);
    expect(info).not.toBeNull();
    expect(info!.data_type).toBe(dtype);
    expect(info!.is_nullable).toBe(nullable);
  });
});

describe('collab_comments columns', () => {
  const cases: [string, string, string][] = [
    ['id',          'integer',                  'NO'],
    ['model_id',    'integer',                  'NO'],
    ['user_id',     'integer',                  'NO'],
    ['entity_type', 'character varying',        'YES'],
    ['entity_id',   'integer',                  'YES'],
    ['parent_id',   'integer',                  'YES'],
    ['body',        'text',                     'NO'],
    ['resolved',    'boolean',                  'NO'],
    ['resolved_at', 'timestamp with time zone', 'YES'],
    ['deleted_at',  'timestamp with time zone', 'YES'],
    ['created_at',  'timestamp with time zone', 'NO'],
    ['updated_at',  'timestamp with time zone', 'NO'],
  ];

  test.each(cases)('column %s has type %s, nullable=%s', async (col, dtype, nullable) => {
    const info = await columnInfo('collab_comments', col);
    expect(info).not.toBeNull();
    expect(info!.data_type).toBe(dtype);
    expect(info!.is_nullable).toBe(nullable);
  });
});

describe('collab_milestones columns', () => {
  const cases: [string, string, string][] = [
    ['id',         'integer',                  'NO'],
    ['model_id',   'integer',                  'NO'],
    ['created_by', 'integer',                  'NO'],
    ['label',      'character varying',        'NO'],
    ['snapshot',   'jsonb',                    'NO'],
    ['created_at', 'timestamp with time zone', 'NO'],
  ];

  test.each(cases)('column %s has type %s, nullable=%s', async (col, dtype, nullable) => {
    const info = await columnInfo('collab_milestones', col);
    expect(info).not.toBeNull();
    expect(info!.data_type).toBe(dtype);
    expect(info!.is_nullable).toBe(nullable);
  });
});

describe('collab_mentions columns', () => {
  const cases: [string, string, string][] = [
    ['id',                 'integer',                  'NO'],
    ['comment_id',         'integer',                  'NO'],
    ['mentioned_user_id',  'integer',                  'NO'],
    ['notified_at',        'timestamp with time zone', 'YES'],
  ];

  test.each(cases)('column %s has type %s, nullable=%s', async (col, dtype, nullable) => {
    const info = await columnInfo('collab_mentions', col);
    expect(info).not.toBeNull();
    expect(info!.data_type).toBe(dtype);
    expect(info!.is_nullable).toBe(nullable);
  });
});

// ===========================================================================
// 3. INDEXES AND UNIQUE CONSTRAINTS
// ===========================================================================

describe('indexes exist', () => {
  const indexes = [
    'idx_collab_activity_model_created',
    'idx_collab_locks_expires',
    'idx_collab_comments_model_entity',
    'idx_collab_milestones_model_created',
    'idx_collab_mentions_user',
  ];

  test.each(indexes)('%s exists', async (idx) => {
    expect(await indexExists(idx)).toBe(true);
  });
});

describe('unique constraints exist', () => {
  it('uq_collab_locks_node on collab_locks', async () => {
    expect(await uniqueConstraintExists('collab_locks', 'uq_collab_locks_node')).toBe(true);
  });

  it('uq_collab_mentions_pair on collab_mentions', async () => {
    expect(await uniqueConstraintExists('collab_mentions', 'uq_collab_mentions_pair')).toBe(true);
  });
});

// ===========================================================================
// 4. NOT NULL VIOLATIONS
// ===========================================================================

describe('NOT NULL constraints are enforced', () => {
  it('collab_activity rejects missing action', async () => {
    await expect(
      pool.query(
        `INSERT INTO collab_activity(model_id, user_id) VALUES($1, $2)`,
        [testModelId, testUserId],
      ),
    ).rejects.toThrow();
  });

  it('collab_locks rejects missing expires_at', async () => {
    await expect(
      pool.query(
        `INSERT INTO collab_locks(model_id, user_id, entity_type, entity_id)
         VALUES($1, $2, 'state', 1)`,
        [testModelId, testUserId],
      ),
    ).rejects.toThrow();
  });

  it('collab_comments rejects missing body', async () => {
    await expect(
      pool.query(
        `INSERT INTO collab_comments(model_id, user_id) VALUES($1, $2)`,
        [testModelId, testUserId],
      ),
    ).rejects.toThrow();
  });

  it('collab_milestones rejects missing snapshot', async () => {
    await expect(
      pool.query(
        `INSERT INTO collab_milestones(model_id, created_by, label) VALUES($1, $2, $3)`,
        [testModelId, testUserId, 'v1'],
      ),
    ).rejects.toThrow();
  });

  it('collab_mentions rejects missing mentioned_user_id', async () => {
    await expect(
      pool.query(
        `INSERT INTO collab_mentions(comment_id) VALUES($1)`,
        [testCommentId],
      ),
    ).rejects.toThrow();
  });
});

// ===========================================================================
// 5. UNIQUE CONSTRAINT ENFORCEMENT
// ===========================================================================

describe('unique constraint: collab_locks (model_id, entity_type, entity_id)', () => {
  const entityType = 'state';
  const entityId = 9991;
  const expiresAt = new Date(Date.now() + 60_000).toISOString();

  afterEach(async () => {
    await pool.query(
      `DELETE FROM collab_locks
       WHERE model_id = $1 AND entity_type = $2 AND entity_id = $3`,
      [testModelId, entityType, entityId],
    );
  });

  it('rejects a duplicate (model_id, entity_type, entity_id)', async () => {
    await pool.query(
      `INSERT INTO collab_locks(model_id, user_id, entity_type, entity_id, expires_at)
       VALUES($1, $2, $3, $4, $5)`,
      [testModelId, testUserId, entityType, entityId, expiresAt],
    );

    await expect(
      pool.query(
        `INSERT INTO collab_locks(model_id, user_id, entity_type, entity_id, expires_at)
         VALUES($1, $2, $3, $4, $5)`,
        [testModelId, testUserId, entityType, entityId, expiresAt],
      ),
    ).rejects.toThrow();
  });
});

describe('unique constraint: collab_mentions (comment_id, mentioned_user_id)', () => {
  afterEach(async () => {
    await pool.query(
      `DELETE FROM collab_mentions WHERE comment_id = $1 AND mentioned_user_id = $2`,
      [testCommentId, testUserId],
    );
  });

  it('rejects a duplicate (comment_id, mentioned_user_id)', async () => {
    await pool.query(
      `INSERT INTO collab_mentions(comment_id, mentioned_user_id) VALUES($1, $2)`,
      [testCommentId, testUserId],
    );

    await expect(
      pool.query(
        `INSERT INTO collab_mentions(comment_id, mentioned_user_id) VALUES($1, $2)`,
        [testCommentId, testUserId],
      ),
    ).rejects.toThrow();
  });
});

// ===========================================================================
// 6. FK CASCADE: deleting stmmodel cascades to all collab_* tables
// ===========================================================================

describe('FK ON DELETE CASCADE from stmmodel', () => {
  let cascadeModelId: number;
  let cascadeUserId: number;

  beforeEach(async () => {
    const m = await pool.query<{ id: number }>(
      `INSERT INTO stmmodel(stm_name) VALUES($1) RETURNING id`,
      [`__test_cascade_${Date.now()}`],
    );
    cascadeModelId = m.rows[0].id;

    const u = await pool.query<{ id: number }>(
      `INSERT INTO auth_users(email, password_hash) VALUES($1, $2) RETURNING id`,
      [`__cascade_${Date.now()}@example.com`, 'hash'],
    );
    cascadeUserId = u.rows[0].id;

    // Insert one row in each collab table that references cascadeModelId
    await pool.query(
      `INSERT INTO collab_activity(model_id, user_id, action) VALUES($1, $2, 'user:join')`,
      [cascadeModelId, cascadeUserId],
    );
    await pool.query(
      `INSERT INTO collab_locks(model_id, user_id, entity_type, entity_id, expires_at)
       VALUES($1, $2, 'state', 1, now() + interval '1 hour')`,
      [cascadeModelId, cascadeUserId],
    );
    const cc = await pool.query<{ id: number }>(
      `INSERT INTO collab_comments(model_id, user_id, body) VALUES($1, $2, $3) RETURNING id`,
      [cascadeModelId, cascadeUserId, 'cascade test comment'],
    );
    const cascadeCommentId = cc.rows[0].id;
    await pool.query(
      `INSERT INTO collab_milestones(model_id, created_by, label, snapshot) VALUES($1, $2, $3, $4)`,
      [cascadeModelId, cascadeUserId, 'v0', JSON.stringify({ states: [] })],
    );
    // collab_mentions references a comment, not the model directly — but let's include it
    await pool.query(
      `INSERT INTO collab_mentions(comment_id, mentioned_user_id) VALUES($1, $2)`,
      [cascadeCommentId, cascadeUserId],
    );
  });

  afterEach(async () => {
    // Safety cleanup in case the test did not delete the model
    await pool.query('DELETE FROM stmmodel  WHERE id = $1', [cascadeModelId]);
    await pool.query('DELETE FROM auth_users WHERE id = $1', [cascadeUserId]);
  });

  it('deleting stmmodel cascades to collab_activity', async () => {
    await pool.query('DELETE FROM stmmodel WHERE id = $1', [cascadeModelId]);
    const res = await pool.query(
      `SELECT COUNT(*) FROM collab_activity WHERE model_id = $1`,
      [cascadeModelId],
    );
    expect(Number(res.rows[0].count)).toBe(0);
  });

  it('deleting stmmodel cascades to collab_locks', async () => {
    await pool.query('DELETE FROM stmmodel WHERE id = $1', [cascadeModelId]);
    const res = await pool.query(
      `SELECT COUNT(*) FROM collab_locks WHERE model_id = $1`,
      [cascadeModelId],
    );
    expect(Number(res.rows[0].count)).toBe(0);
  });

  it('deleting stmmodel cascades to collab_comments', async () => {
    await pool.query('DELETE FROM stmmodel WHERE id = $1', [cascadeModelId]);
    const res = await pool.query(
      `SELECT COUNT(*) FROM collab_comments WHERE model_id = $1`,
      [cascadeModelId],
    );
    expect(Number(res.rows[0].count)).toBe(0);
  });

  it('deleting stmmodel cascades to collab_milestones', async () => {
    await pool.query('DELETE FROM stmmodel WHERE id = $1', [cascadeModelId]);
    const res = await pool.query(
      `SELECT COUNT(*) FROM collab_milestones WHERE model_id = $1`,
      [cascadeModelId],
    );
    expect(Number(res.rows[0].count)).toBe(0);
  });
});
