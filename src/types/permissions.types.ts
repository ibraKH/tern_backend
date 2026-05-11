export type ModelRole = 'owner' | 'editor' | 'reviewer' | 'viewer';

export interface ModelPermission {
  id: number;
  stm_name: string;
  user_email: string;
  role: ModelRole;
  granted_by: string | null;
  granted_at: string;
}
