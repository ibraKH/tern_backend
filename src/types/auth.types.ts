export type User = {
  id: number;
  email: string;
  password_hash: string;
  role: 'Admin' | 'Viewer' | 'Editor';
  contributor_id?: number | null;
};

export type Signup = { 
    name: string;
    email: string; 
    password: string; 
    role: User["role"] 
};

export type Login  = { 
    email: string; 
    password: string 
};
