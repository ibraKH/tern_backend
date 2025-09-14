import express, { Request, Response, NextFunction } from 'express';
import { saveModel } from '../services/models.service';

const models = express.Router();

models.get("/", (req: Request, res: Response) => {
    res.send("Models route");
})


// POST route for saving a model
models.post('/', async (req: Request, res: Response) => {
  try {
    const modelData = req.body;
    const saved = await saveModel(modelData);
    res.json({ message: 'Model saved successfully', data: saved });
  } catch (error) {
    res.status(500).json({ message: 'Error saving model', error });
  }
});

export default models;