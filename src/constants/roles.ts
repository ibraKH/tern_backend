export const GLOBAL_ROLES = {
  ADMIN: 'Admin',
  EDITOR: 'Editor',
  VIEWER: 'Viewer',
} as const;

export const MODEL_ROLES = {
  OWNER: 'owner',
  EDITOR: 'editor',
  REVIEWER: 'reviewer',
  VIEWER: 'viewer',
} as const;

export type GlobalRole = typeof GLOBAL_ROLES[keyof typeof GLOBAL_ROLES];
export type ModelRole = typeof MODEL_ROLES[keyof typeof MODEL_ROLES];
