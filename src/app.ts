import type { Request, Response } from 'express';
import express from 'express';
import cors from 'cors';
import helmet from "helmet";

import authRoutes from './routes/auth';
import modelsRoutes from './routes/models';
import { requireAuth } from "./middlewares/auth.middleware";

const app = express();

// Middlewares
app.use(helmet());
app.use(cors()); // TODO: restrict in production
app.use(express.json());


// Routes
app.use('/auth', authRoutes);     
app.use('/models', requireAuth, modelsRoutes);

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Page not found' });
});

export default app;
