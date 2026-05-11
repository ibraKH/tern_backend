/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
export const shorthands = undefined;

/**
 * TASK-25 + TASK-26 — Cascade rules verification + composite index
 *
 * Cascade audit results:
 *   model_permissions.stm_name  → stmmodel.stm_name    CASCADE ✅ (fk_model_permissions_stm_name, migration 1758800000000)
 *   model_permissions.user_email → auth_users.email     FK MISSING ← added here with CASCADE
 *   collab_comments.model_id    → stmmodel.id           CASCADE ✅ (fk_collab_comments_model, migration 1758600000000)
 *   collab_locks.model_id       → stmmodel.id           CASCADE ✅ (fk_collab_locks_model,    migration 1758600000000)
 *   collab_milestones.model_id  → stmmodel.id           CASCADE ✅ (fk_collab_milestones_model,migration 1758600000000)
 *
 * Index audit results (TASK-26):
 *   idx_model_permissions_stm_name   ✅ (migration 1758800000000)
 *   idx_model_permissions_user_email ✅ (migration 1758800000000)
 *   idx_model_permissions_composite  MISSING ← added here
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
export const up = (pgm) => {
  // TASK-25: Add missing FK from model_permissions.user_email to auth_users.email with CASCADE.
  // When an auth_user is deleted, their permission rows are automatically removed.
  pgm.addConstraint('model_permissions', 'fk_model_permissions_user_email', {
    foreignKeys: {
      columns: 'user_email',
      references: 'auth_users(email)',
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
  });

  // TASK-26: Add composite index to accelerate the common (stm_name, user_email) lookup.
  pgm.createIndex('model_permissions', ['stm_name', 'user_email'], {
    name: 'idx_model_permissions_composite',
    ifNotExists: true,
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
export const down = (pgm) => {
  pgm.dropIndex('model_permissions', ['stm_name', 'user_email'], {
    name: 'idx_model_permissions_composite',
    ifExists: true,
  });
  pgm.dropConstraint('model_permissions', 'fk_model_permissions_user_email', { ifExists: true });
};
