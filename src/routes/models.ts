import express, { Request, Response, NextFunction } from 'express';
import { saveModel } from '../services/models.service';

const models = express.Router();

models.get("/", (req: Request, res: Response) => {
    res.send("Models route");
})


// POST route for saving a model
models.post('/save', async (req, res) => {
  try {
    const modelId = await saveModel(req.body);
    res.status(201).json({ success: true, modelId });
  } catch (error) {
    console.error('Error saving model:', error);
    res.status(500).json({ success: false, error: 'Failed to save model' });
  }
});

export default models;