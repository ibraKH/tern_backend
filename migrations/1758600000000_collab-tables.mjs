// 1758600000000_collab-tables.mjs
/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
export const shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  // 1) collab_activity — log of all editing events in a model room
  pgm.createTable('collab_activity', {
    id: { type: 'serial', primaryKey: true },
    model_id: { type: 'integer', notNull: true },
    user_id: { type: 'integer', notNull: true },
    action: { type: 'varchar(100)', notNull: true },
    entity_type: { type: 'varchar(100)' },
    entity_id: { type: 'integer' },
    detail: { type: 'jsonb' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  }, { ifNotExists: true });

  pgm.addConstraint('collab_activity', 'fk_collab_activity_model', {
    foreignKeys: {
      columns: 'model_id',
      references: 'stmmodel(id)',
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
  });
  pgm.addConstraint('collab_activity', 'fk_collab_activity_user', {
    foreignKeys: {
      columns: 'user_id',
      references: 'auth_users(id)',
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
  });

  pgm.createIndex('collab_activity', ['model_id', { name: 'created_at', sort: 'DESC' }], {
    name: 'idx_collab_activity_model_created',
    ifNotExists: true,
  });

  // 2) collab_locks — exclusive edit locks on nodes
  pgm.createTable('collab_locks', {
    id: { type: 'serial', primaryKey: true },
    model_id: { type: 'integer', notNull: true },
    user_id: { type: 'integer', notNull: true },
    entity_type: { type: 'varchar(100)', notNull: true },
    entity_id: { type: 'integer', notNull: true },
    locked_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    expires_at: { type: 'timestamptz', notNull: true },
  }, { ifNotExists: true });

  pgm.addConstraint('collab_locks', 'fk_collab_locks_model', {
    foreignKeys: {
      columns: 'model_id',
      references: 'stmmodel(id)',
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
  });
  pgm.addConstraint('collab_locks', 'fk_collab_locks_user', {
    foreignKeys: {
      columns: 'user_id',
      references: 'auth_users(id)',
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
  });
  pgm.addConstraint('collab_locks', 'uq_collab_locks_node', {
    unique: ['model_id', 'entity_type', 'entity_id'],
  });

  pgm.createIndex('collab_locks', 'expires_at', {
    name: 'idx_collab_locks_expires',
    ifNotExists: true,
  });

  // 3) collab_comments — threaded comments attached to nodes
  pgm.createTable('collab_comments', {
    id: { type: 'serial', primaryKey: true },
    model_id: { type: 'integer', notNull: true },
    user_id: { type: 'integer', notNull: true },
    entity_type: { type: 'varchar(100)' },
    entity_id: { type: 'integer' },
    parent_id: { type: 'integer' },
    body: { type: 'text', notNull: true },
    resolved: { type: 'boolean', notNull: true, default: false },
    resolved_at: { type: 'timestamptz' },
    deleted_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  }, { ifNotExists: true });

  pgm.addConstraint('collab_comments', 'fk_collab_comments_model', {
    foreignKeys: {
      columns: 'model_id',
      references: 'stmmodel(id)',
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
  });
  pgm.addConstraint('collab_comments', 'fk_collab_comments_user', {
    foreignKeys: {
      columns: 'user_id',
      references: 'auth_users(id)',
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
  });
  pgm.addConstraint('collab_comments', 'fk_collab_comments_parent', {
    foreignKeys: {
      columns: 'parent_id',
      references: 'collab_comments(id)',
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
  });

  pgm.createIndex('collab_comments', ['model_id', 'entity_type', 'entity_id'], {
    name: 'idx_collab_comments_model_entity',
    ifNotExists: true,
  });

  // 4) collab_milestones — named snapshots of a model's canvas state
  pgm.createTable('collab_milestones', {
    id: { type: 'serial', primaryKey: true },
    model_id: { type: 'integer', notNull: true },
    created_by: { type: 'integer', notNull: true },
    label: { type: 'varchar(255)', notNull: true },
    snapshot: { type: 'jsonb', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  }, { ifNotExists: true });

  pgm.addConstraint('collab_milestones', 'fk_collab_milestones_model', {
    foreignKeys: {
      columns: 'model_id',
      references: 'stmmodel(id)',
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
  });
  pgm.addConstraint('collab_milestones', 'fk_collab_milestones_creator', {
    foreignKeys: {
      columns: 'created_by',
      references: 'auth_users(id)',
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
  });

  pgm.createIndex('collab_milestones', ['model_id', { name: 'created_at', sort: 'DESC' }], {
    name: 'idx_collab_milestones_model_created',
    ifNotExists: true,
  });

  // 5) collab_mentions — maps a comment to @mentioned users
  pgm.createTable('collab_mentions', {
    id: { type: 'serial', primaryKey: true },
    comment_id: { type: 'integer', notNull: true },
    mentioned_user_id: { type: 'integer', notNull: true },
    notified_at: { type: 'timestamptz' },
  }, { ifNotExists: true });

  pgm.addConstraint('collab_mentions', 'fk_collab_mentions_comment', {
    foreignKeys: {
      columns: 'comment_id',
      references: 'collab_comments(id)',
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
  });
  pgm.addConstraint('collab_mentions', 'fk_collab_mentions_user', {
    foreignKeys: {
      columns: 'mentioned_user_id',
      references: 'auth_users(id)',
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
  });
  pgm.addConstraint('collab_mentions', 'uq_collab_mentions_pair', {
    unique: ['comment_id', 'mentioned_user_id'],
  });

  pgm.createIndex('collab_mentions', 'mentioned_user_id', {
    name: 'idx_collab_mentions_user',
    ifNotExists: true,
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  // Drop indexes first (reverse creation order)
  pgm.dropIndex('collab_mentions', 'mentioned_user_id', { name: 'idx_collab_mentions_user', ifExists: true });
  pgm.dropIndex('collab_milestones', ['model_id', 'created_at'], { name: 'idx_collab_milestones_model_created', ifExists: true });
  pgm.dropIndex('collab_comments', ['model_id', 'entity_type', 'entity_id'], { name: 'idx_collab_comments_model_entity', ifExists: true });
  pgm.dropIndex('collab_locks', 'expires_at', { name: 'idx_collab_locks_expires', ifExists: true });
  pgm.dropIndex('collab_activity', ['model_id', 'created_at'], { name: 'idx_collab_activity_model_created', ifExists: true });

  // Drop tables in reverse dependency order
  pgm.dropTable('collab_mentions', { ifExists: true, cascade: true });
  pgm.dropTable('collab_milestones', { ifExists: true, cascade: true });
  pgm.dropTable('collab_comments', { ifExists: true, cascade: true });
  pgm.dropTable('collab_locks', { ifExists: true, cascade: true });
  pgm.dropTable('collab_activity', { ifExists: true, cascade: true });
};
