export type ModelRole = 'viewer' | 'editor' | 'reviewer';

export interface ModelPermission {
  id: number;
  stm_name: string;
  user_email: string;
  role: ModelRole;
  granted_by: string | null;
  granted_at: string;
}
