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

const app = express();

// Middlewares
app.use(helmet());
app.use(cors()); // TODO: restrict in production
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
  res.status(404).json({ error: 'Page not found' });
});

export default app;
