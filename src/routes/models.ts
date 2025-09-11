import express, { Request, Response, NextFunction } from 'express';

const models = express.Router();

models.get("/", (req: Request, res: Response) => {
    res.send("Models route");
})

export default models;