import { z } from 'zod';

export const signupSchema = z.object({
  name: z.string().trim().min(1, 'name required').max(100),
  email: z.string().email('invalid email'),
  password: z.string().min(8, 'min 8 chars').max(72, 'max 72 chars'),
  role: z.enum(['Admin','Viewer','Editor']).optional().default('Viewer')
});

export const loginSchema = z.object({
  email: z.string().email('invalid email'),
  password: z.string().min(1, 'password required')
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
