import type { Request, Response, NextFunction } from 'express';
import express from 'express';
import { createUser, authenticate, getUserByEmail } from "../services/auth.service";
import { signToken } from "../utils/jwt";
import { validate } from '../validation/validate';
import { signupSchema, loginSchema } from '../validation/auth.schemas';
import { AppError, AuthInvalidError, ConflictError } from "../errors";
import { getPendingMentions } from "../services/collab/mentions.service";
import { limitSignup, limitLogin } from "../middlewares/rateLimit";

const auth = express.Router();

/**
 * @openapi
 * tags:
 *   - name: Auth
 *     description: User authentication and registration endpoints
 * components:
 *   schemas:
 *     SignupRequest:
 *       type: object
 *       required:
 *         - name
 *         - email
 *         - password
 *         - role (Optional - defaults to 'Viewer')
 *       properties:
 *         name:
 *          type: string
 *          example: Admin
 *         email:
 *           type: string
 *           format: email
 *           example: admin@admin.com
 *         password:
 *           type: string
 *           format: password
 *           minLength: 6
 *           example: secret123
 *     LoginRequest:
 *       type: object
 *       required:
 *         - email
 *         - password
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *           example: admin@admin.com
 *         password:
 *           type: string
 *           format: password
 *           example: secret123
 *     User:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: "1"
 *         email:
 *           type: string
 *           example: admin@admin.com
 *         role:
 *           type: string
 *           example: user
 *     AuthResponse:
 *       type: object
 *       properties:
 *         token:
 *           type: string
 *           example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9
 *         user:
 *           $ref: '#/components/schemas/User'
 */

// auth health check endpoint
/**
 * @openapi
 * /auth/health:
 *   get:
 *     summary: Health check for the auth service
 *     tags:
 *       - Auth
 *     responses:
 *       200:
 *         description: Returns a message indicating the service is healthy.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: Auth service is healthy
 */
// auth health check endpoint
auth.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'Auth service is healthy' });
});

/**
 * @openapi
 * /auth/signup:
 *   post:
 *     summary: Register a new user
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SignupRequest'
 *     responses:
 *       201:
 *         description: User created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       409:
 *         description: Email already in use
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: email already in use
 *       500:
 *         description: Signup failed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: signup failed
 */
auth.post("/signup", limitSignup, validate({ body: signupSchema }), async (req : Request, res : Response, next: NextFunction) => {
  const body = req.body;
  try {
    const existing = await getUserByEmail(body.email);
    if (existing) throw new ConflictError("email already in use", { field: "email" });
    const user = await createUser(body);
    const token = signToken({ uid: user.id, email: user.email, role: user.role });
    res.status(201).json({ token, user: { id: user.id, email: user.email, role: user.role } });
  } catch (e: unknown) {
    if (e instanceof AppError) return next(e);
    console.error("[/auth/signup] error:", (e as Error).message || e);
    res.status(500).json({ error: "signup failed" });
  }
});

/**
 * @openapi
 * /auth/login:
 *   post:
 *     summary: Authenticate an existing user
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: User authenticated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       401:
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: invalid credentials
 *       500:
 *         description: Login failed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: login failed
 */
auth.post("/login", limitLogin, validate({ body: loginSchema }), async (req : Request, res : Response, next: NextFunction) => {
  const body = req.body;
  try {
    const user = await authenticate(body);
    if (!user) throw new AuthInvalidError();
    const token = signToken({ uid: user.id, email: user.email, role: user.role });
    // Fetch pending mention count so the frontend can show a badge immediately on login.
    const pendingMentions = await getPendingMentions(user.id);
    res.json({ token, user: { id: user.id, email: user.email, role: user.role }, pendingMentionCount: pendingMentions.length });
  } catch (e: unknown) {
    if (e instanceof AppError) return next(e);
    res.status(500).json({ error: "login failed" });
  }
});

export default auth;