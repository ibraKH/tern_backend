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
import driversRoutes from './routes/drivers';
import notificationsRoutes from './routes/notifications';
import permissionsRoutes from './routes/permissions';
import adminRoutes from './routes/admin';
import { requireAuth } from "./middlewares/auth.middleware";
import { requireAdmin } from "./middlewares/requireAdmin";
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
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  exposedHeaders: ['X-Request-ID'],
}));

app.use(express.json({ limit: '10mb' }));
app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Routes
app.use('/auth', authRoutes);
app.use('/models', requireAuth, modelsRoutes, permissionsRoutes, locksRoutes);
app.use('/drivers', requireAuth, driversRoutes);
app.use('/collab', collabRoutes);
app.use('/notifications', notificationsRoutes);
app.use('/api/admin', requireAuth, requireAdmin, adminRoutes);
app.use((req, _res, next) => {
  console.log(`[DEBUG ROUTE] ${req.method} ${req.path}`);
  console.log("User:", (req as any).user);
  next();
});
app.get("/openapi.json", (_req, res) => res.json(swaggerSpec));

// Error handling middleware
app.use(errorHandler);
//console.log(app._router.stack.map(r => r?.route?.path).filter(Boolean));

// 404 handler
const frontendUrl = process.env.FRONTEND_URL || 'https://stm-8nizc.ondigitalocean.app';
app.use((_req: Request, res: Response) => {
 // console.log(app._router.stack.map(r => r?.route?.path).filter(Boolean));
  res.redirect(`${frontendUrl}/notfound`);
});

export default app;