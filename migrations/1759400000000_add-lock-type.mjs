/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
export const shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
export const up = (pgm) => {
  pgm.addColumn('collab_locks', {
    lock_type: {
      type: 'varchar(10)',
      notNull: true,
      default: 'edit',
      check: "lock_type IN ('edit', 'review')",
    },
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
export const down = (pgm) => {
  pgm.dropColumn('collab_locks', 'lock_type');
};
