import type { Request, Response } from 'express';
import express from 'express';
import { saveModel } from '../services/models/save.service';
import { getAllModels, getModelByName } from '../services/models/show.service';
import { removeModelByName,removeState,removeTransitionByBusinessId } from '../services/models/remove.service';
import { requireRole } from '../middlewares/role.middleware';

const models = express.Router();

// Health check endpoint
models.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'Models service is healthy' });
});

// GET /models: get all model names
models.get('/all', requireRole(["Admin"]), async (req: Request, res: Response) => {
  try {
    const modelNames = await getAllModels();
    res.json(modelNames);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error fetching model names', error });
  }
});

// GET /models/:name: get model details by name
models.get('/:name', requireRole(["Admin", "Editor", "Viewer"]), async (req: Request, res: Response) => {
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
models.post('/save', requireRole(["Admin", "Editor"]), async (req, res) => {
  try {
    const modelId = await saveModel(req.body);
    res.status(201).json({ success: true, modelId });
  } catch (error) {
    console.error('Error saving model:', error);
    res.status(500).json({ success: false, error: 'Failed to save model' });
  }
});

// DELETE /models/:name:
models.delete('/:name', requireRole(["Admin"]), async (req: Request, res: Response) => {
  try {
    const { name } = req.params as { name: string };
    const r = await removeModelByName(name);
    res.json({ success: true, ...r });
  } catch (error: any) {
    const status = error?.status ?? 500;
    res.status(status).json({ message: 'Error removing model', error: String(error?.message ?? error) });
  }
});

// DELETE /models/:name/states/:stateId:
models.delete('/:name/states/:stateId', requireRole(["Admin", "Editor"]), async (req: Request, res: Response) => {
  try {
    const { name, stateId } = req.params as { name: string; stateId: string };
    await removeState(name, Number(stateId));
    res.json({ success: true });
  } catch (error: any) {
    const status = error?.status ?? 500;
    res.status(status).json({ message: 'Error removing state', error: String(error?.message ?? error) });
  }
});

// DELETE /models/:name/transitions/:transitionId:
models.delete('/:name/transitions/:transitionId', requireRole(["Admin", "Editor"]), async (req: Request, res: Response) => {
  try {
    const { name, transitionId } = req.params as { name: string; transitionId: string };
    await removeTransitionByBusinessId(name, Number(transitionId));
    res.json({ success: true });
  } catch (error: any) {
    const status = error?.status ?? 500;
    res.status(status).json({ message: 'Error removing transition', error: String(error?.message ?? error) });
  }
});

export default models;