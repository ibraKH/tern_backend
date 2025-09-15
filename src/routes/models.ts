import express, { Request, Response, NextFunction } from 'express';
import { getAllModels } from '../services/models.service';
import { getModelByName } from '../services/models.service';

const models = express.Router();

models.get("/", (req: Request, res: Response) => {
    res.send("Models route");
})


// GET /models: get all model names
models.get('/models', async (req: Request, res: Response) => {
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




export default models;

