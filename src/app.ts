import type { Request, Response } from 'express';
import express from 'express';
import cors from 'cors';
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./swagger/swagger";

import authRoutes from './routes/auth';
import modelsRoutes from './routes/models';
import collabRoutes from './routes/collab';
import { requireAuth } from "./middlewares/auth.middleware";
import { errorHandler } from "./middlewares/error.middleware";
import { requestId } from "./middlewares/requestId.middleware";
import { FRONTEND_URL, CORS_ALLOWED_ORIGINS } from './config/env';

const app = express();

app.use(requestId);

// Security headers with Helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // unsafe-inline needed for Swagger UI
      styleSrc: ["'self'", "'unsafe-inline'"], // unsafe-inline needed for Swagger UI
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

const frontendUrl = FRONTEND_URL;
const allowedOrigins = Array.from(CORS_ALLOWED_ORIGINS);

app.use(cors({
  origin: (origin, callback) => {
    console.log('CORS origin check:', origin);
    console.log('Allowed origins:', allowedOrigins);
    
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      console.log('Origin allowed:', origin);
      callback(null, true);
    } else {
      console.log('Origin blocked:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  exposedHeaders: ['X-Request-ID'],
}));

app.use(express.json());
app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Routes
app.use('/auth', authRoutes);
app.use('/models', requireAuth, modelsRoutes);
app.use('/collab', collabRoutes);
app.get("/openapi.json", (_req, res) => res.json(swaggerSpec));

// Error handling middleware
app.use(errorHandler);

// 404 handler
app.use((req: Request, res: Response) => {
  res.redirect(`${frontendUrl}/notfound`);
});

export default app;
