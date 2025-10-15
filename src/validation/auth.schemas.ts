import { z } from 'zod';

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("invalid email")
  .max(254, "email too long");

const nameSchema = z
  .string()
  .trim()
  .min(1, "name required")
  .max(100, "name too long");

const passwordSchema = z
  .string()
  .min(8, "min 8 chars")
  .max(72, "max 72 chars")
  .regex(/[A-Za-z]/, "must contain a letter")
  .regex(/[0-9]/, "must contain a digit")
  .regex(/[^A-Za-z0-9]/, "must contain a special char")
  .refine((val) => !/\s/.test(val), "no spaces allowed");

const loginPasswordSchema = z
  .string()
  .min(1, "password is required");

export const signupSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  role: z.enum(['Admin','Viewer','Editor']).optional().default('Viewer')
});

export const loginSchema = z.object({
  email: emailSchema,
  password: loginPasswordSchema
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
