import express, { Request, Response } from 'express';
import pool from '../database';
import { log } from 'console';

const router = express.Router();

console.log('Services router loaded');


export default router;