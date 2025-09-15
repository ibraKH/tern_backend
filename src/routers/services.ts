import express, { Request, Response } from 'express';
import pool from '../database';

const router = express.Router();

router.get('/name', async (req: Request, res: Response) => {
    try {
        const result = await pool.query('SELECT a FROM test_a');
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching service names:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

export default router;