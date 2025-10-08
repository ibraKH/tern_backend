import type { Request, Response } from 'express';
import express from 'express';
import { createUser, authenticate, getUserByEmail } from "../services/auth.service";
import { signToken } from "../utils/jwt";
import { validate } from '../validation/validate';
import { signupSchema, loginSchema } from '../validation/auth.schemas';

const auth = express.Router();

// auth health check endpoint
auth.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'Auth service is healthy' });
});

auth.post("/signup", validate({ body: signupSchema }), async (req : Request, res : Response) => {
  const body = req.body;
  try {
    const existing = await getUserByEmail(body.email);
    if (existing) return res.status(409).json({ error: "email already in use" });
    const user = await createUser(body);
    const token = signToken({ uid: user.id, email: user.email, role: user.role });
    res.status(201).json({ token, user: { id: user.id, email: user.email, role: user.role } });
  } catch (e: unknown) {
    console.error("[/auth/signup] error:", (e as Error).message || e);
    res.status(500).json({ error: "signup failed" });
  }
});

auth.post("/login", validate({ body: loginSchema }), async (req : Request, res : Response) => {
  const body = req.body;
  try {
    const user = await authenticate(body);
    if (!user) return res.status(401).json({ error: "invalid credentials" });
    const token = signToken({ uid: user.id, email: user.email, role: user.role });
    res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
  } catch {
    res.status(500).json({ error: "login failed" });
  }
});

export default auth;