// 1758700000000_collab-comments-soft-delete-and-resolved-at.mjs
/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
export const shorthands = undefined;

export const up = (pgm) => {
  pgm.addColumn('collab_comments', {
    deleted_at: { type: 'timestamptz' },
    resolved_at: { type: 'timestamptz' },
  });
};

export const down = (pgm) => {
  pgm.dropColumn('collab_comments', 'deleted_at');
  pgm.dropColumn('collab_comments', 'resolved_at');
};
