import express, { Request, Response } from 'express';
import { createUser, authenticate, getUserByEmail } from "../services/auth.service";
import { signToken } from "../utils/jwt";
import type { Signup, Login } from "../types/auth.types";

const auth = express.Router();

auth.post("/signup", async (req : Request, res : Response) => {
  const body = req.body as Signup;
  if (!body?.email || !body?.password)
    return res.status(400).json({ error: "email and password required" });

  try {
    const existing = await getUserByEmail(body.email);
    if (existing) return res.status(409).json({ error: "email already in use" });

    const user = await createUser(body);
    const token = signToken({ uid: user.id, email: user.email, role: user.role });
    res.status(201).json({ token, user: { id: user.id, email: user.email, role: user.role } });
  } catch (e) {
    res.status(500).json({ error: "signup failed" });
  }
});

auth.post("/login", async (req : Request, res : Response) => {
  const body = req.body as Login;
  if (!body?.email || !body?.password)
    return res.status(400).json({ error: "email and password required" });

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