import express, { Request, Response, NextFunction } from 'express';

const auth = express.Router();

auth.get("/", (req: Request, res: Response) => {
    res.send("Auth route");
})

export default auth;