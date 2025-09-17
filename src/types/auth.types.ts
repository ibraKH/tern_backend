export type User = {
  id: number;
  email: string;
  password_hash: string;
  role: "author" | "reviewer";
  contributor_id?: number | null;
};

export type Signup = { 
    email: string; 
    password: string; 
    role?: User["role"] 
};

export type Login  = { 
    email: string; 
    password: string 
};
