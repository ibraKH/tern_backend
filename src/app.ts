import type { Request, Response } from 'express';
import express from 'express';
import cors from 'cors';
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./swagger/swagger";

import authRoutes from './routes/auth';
import modelsRoutes from './routes/models';
import collabRoutes from './routes/collab';
import locksRoutes from './routes/locks';
import adminRouter from './routes/admin';
import { requireAuth } from "./middlewares/auth.middleware";
import { errorHandler } from "./middlewares/error.middleware";
import { requestId } from "./middlewares/requestId.middleware";
import multer from 'multer';

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

const allowedOrigins = [
  process.env.FRONTEND_URL || 'https://stm-8nizc.ondigitalocean.app',
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

app.use(express.json({ limit: '10mb' }));
app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Routes
app.use('/auth', authRoutes);
app.use('/models', requireAuth, modelsRoutes);
app.use('/models', requireAuth, locksRoutes);
app.use('/collab', collabRoutes);
app.use('/admin', adminRouter);
app.get("/openapi.json", (_req, res) => res.json(swaggerSpec));


// 413 ECONNRESET
app.use((err: any, req: any, res: any, next: any) => {
  // multer error handling
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File too large' });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: 'Unexpected file field' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err.message === 'Invalid file type') {
    return res.status(400).json({ error: 'Invalid file type' });
  }
  next(err);
});

// Error handling middleware
app.use(errorHandler);

// 404 handler
const frontendUrl = process.env.FRONTEND_URL || 'https://stm-8nizc.ondigitalocean.app';
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.originalUrl,
  });
});

export default app;
