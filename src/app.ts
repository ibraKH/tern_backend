import express, { Request, Response, NextFunction} from 'express';
import cors from 'cors';

import authRoutes from './routes/auth';
import modelsRoutes from './routes/models';

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Routes
app.use('/auth', authRoutes);     
app.use('/models', modelsRoutes);

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Page not found' });
});

export default app;
