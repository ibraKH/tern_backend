import type { Request, Response } from 'express';
import express from 'express';
import cors from 'cors';
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./swagger/swagger";

import authRoutes from './routes/auth';
import modelsRoutes from './routes/models';
import { requireAuth } from "./middlewares/auth.middleware";
import { errorHandler } from "./middlewares/error.middleware";
import { requestId } from "./middlewares/requestId.middleware";

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

const frontendUrl = process.env.FRONTEND_URL;
if (!frontendUrl) {
  throw new Error(
    '[config] FRONTEND_URL is required (used for CORS and 404 redirects). Add it to your .env file, e.g. FRONTEND_URL=http://localhost:5173'
  );
}

const allowedOrigins = [
  frontendUrl,
  process.env.PRODUCTION_URL || 'https://hammerhead-app-t8l9y.ondigitalocean.app',
  'http://localhost:5173', // dev frontend
  'http://localhost:3000', // dev backend
];

app.use(cors({
  origin: (origin, callback) => {    
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
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
app.get("/openapi.json", (_req, res) => res.json(swaggerSpec));

// Error handling middleware
app.use(errorHandler);

// 404 handler
app.use((req: Request, res: Response) => {
  res.redirect(`${frontendUrl}/notfound`);
});

export default app;
