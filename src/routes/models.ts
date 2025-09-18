import express, { Request, Response, NextFunction } from 'express';
import { saveModel } from '../services/models.service';
import { getAllModels } from '../services/models.service';
import { getModelByName } from '../services/models.service';
import pool from '../config/database';

const models = express.Router();

// GET /models: get all model names
models.get('/all', async (req: Request, res: Response) => {
  try {
    const modelNames = await getAllModels();
    res.json(modelNames);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching model names', error });
  }
});



// GET /models/:name: get model details by name
models.get('/models/:name', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const model = await getModelByName(name);
    if (!model) {
      return res.status(404).json({ message: `Model with name '${name}' not found` });

    }
    res.json(model);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching model details', error });
  }
});




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