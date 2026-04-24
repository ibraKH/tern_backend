import type { Request, Response, NextFunction } from 'express';
import express from 'express';
import {
  createUser,
  authenticate,
  getUserByEmail,
  createVerificationToken,
  consumeVerificationToken,
} from "../services/auth.service";
import { sendVerificationEmail } from "../services/email.service";
import { signToken } from "../utils/jwt";
import { validate } from '../validation/validate';
import {
  signupSchema,
  loginSchema,
  verifyTokenSchema,
  resendVerificationSchema,
} from '../validation/auth.schemas';
import { AppError, AuthInvalidError, ConflictError } from "../errors";
import { limitSignup, limitLogin, limitResendVerification } from "../middlewares/rateLimit";

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
 *         description: Account created — verification email sent
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "verification email sent to user@example.com"
 *       409:
 *         description: Email already in use
 *       500:
 *         description: Signup failed
 */
auth.post("/signup", limitSignup, validate({ body: signupSchema }), async (req: Request, res: Response, next: NextFunction) => {
  const body = req.body;
  try {
    const existing = await getUserByEmail(body.email);
    if (existing) throw new ConflictError("email already in use", { field: "email" });

    const user = await createUser(body);
    const rawToken = await createVerificationToken(user.id);

    // fire-and-forget: if email fails, the user can resend via POST /auth/resend-verification
    sendVerificationEmail(user.email, rawToken).catch((err) =>
      console.error("[/auth/signup] email delivery failed:", err.message)
    );

    res.status(201).json({ message: `verification email sent to ${user.email}` });
  } catch (e: unknown) {
    if (e instanceof AppError) return next(e);
    console.error("[/auth/signup] error:", (e as Error).message || e);
    res.status(500).json({ error: "signup failed" });
  }
});

/**
 * @openapi
 * /auth/verify:
 *   post:
 *     summary: Verify email address using the token from the verification email
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *             properties:
 *               token:
 *                 type: string
 *                 example: "abc123..."
 *     responses:
 *       200:
 *         description: Email verified — returns JWT and user
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       400:
 *         description: Invalid or expired token
 */
auth.post("/verify", validate({ body: verifyTokenSchema }), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await consumeVerificationToken(req.body.token);
    const token = signToken({ uid: user.id, email: user.email, role: user.role });
    res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
  } catch (e: unknown) {
    if (e instanceof AppError) return next(e);
    console.error("[/auth/verify] error:", (e as Error).message || e);
    res.status(500).json({ error: "verification failed" });
  }
});

/**
 * @openapi
 * /auth/resend-verification:
 *   post:
 *     summary: Resend the verification email to an unverified account
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: user@example.com
 *     responses:
 *       200:
 *         description: If an unverified account exists a new email has been sent
 *       429:
 *         description: Too many resend attempts
 */
auth.post("/resend-verification", limitResendVerification, validate({ body: resendVerificationSchema }), async (req: Request, res: Response) => {
  // always respond the same way to avoid leaking whether an email is registered
  const GENERIC_RESPONSE = { message: "if that email has an unverified account, a new verification email has been sent" };
  try {
    const user = await getUserByEmail(req.body.email);
    if (user && !user.is_verified) {
      const rawToken = await createVerificationToken(user.id);
      sendVerificationEmail(user.email, rawToken).catch((err) =>
        console.error("[/auth/resend-verification] email delivery failed:", err.message)
      );
    }
    res.json(GENERIC_RESPONSE);
  } catch {
    res.json(GENERIC_RESPONSE);
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
 *       403:
 *         description: Email not verified
 *       500:
 *         description: Login failed
 */
auth.post("/login", limitLogin, validate({ body: loginSchema }), async (req: Request, res: Response, next: NextFunction) => {
  const body = req.body;
  try {
    const user = await authenticate(body);
    if (!user) throw new AuthInvalidError();
    const token = signToken({ uid: user.id, email: user.email, role: user.role });
    res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
  } catch (e: unknown) {
    if (e instanceof AppError) return next(e);
    res.status(500).json({ error: "login failed" });
  }
});

export default auth;
