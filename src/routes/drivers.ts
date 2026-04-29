import type { Request, Response } from 'express';
import express from 'express';
import { searchDrivers, getSubDrivers } from '../services/drivers/search.service';
import { requireRole } from '../middlewares/role.middleware';
import { validate } from '../validation/validate';
import { searchDriversQuerySchema, getSubDriversParamsSchema } from '../validation/drivers.validation';
import { limitDriversRead } from '../middlewares/rateLimit';

const drivers = express.Router();

/**
 * @openapi
 * tags:
 *   - name: Drivers
 *     description: Read-only endpoints for driver autocomplete in the transition panel UI
 *
 * components:
 *   schemas:
 *     DriverResult:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         name:
 *           type: string
 *         description:
 *           type: string
 *           nullable: true
 *         driver_group:
 *           type: string
 *           nullable: true
 *
 *     SubDriverResult:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         driver_type:
 *           type: string
 *           nullable: true
 *         driver_description:
 *           type: string
 *           nullable: true
 *         management_driver_id:
 *           type: integer
 */

/**
 * @openapi
 * /drivers/search:
 *   get:
 *     summary: Autocomplete search for drivers
 *     description: >
 *       Returns drivers whose name contains the search term (case-insensitive).
 *       Designed for the transition panel autocomplete — keep `limit` low for fast UI responses.
 *     tags: [Drivers]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         description: Partial driver name to search for (max 100 chars).
 *         schema:
 *           type: string
 *           example: fire
 *       - in: query
 *         name: limit
 *         required: false
 *         description: Maximum number of results to return (1–50, default 20).
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 20
 *     responses:
 *       200:
 *         description: Matching drivers (empty array when nothing matches).
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/DriverResult'
 *       400:
 *         description: Invalid query parameters.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       401:
 *         description: Missing or invalid JWT.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       429:
 *         description: Rate limit exceeded.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       500:
 *         description: Server error.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
drivers.get(
  '/search',
  limitDriversRead,
  requireRole(['Admin', 'Editor', 'Viewer']),
  validate({ query: searchDriversQuerySchema }),
  async (req: Request, res: Response) => {
    try {
      // After validation the query is already typed with coerced number for limit
      const { q, limit } = req.query as unknown as { q: string; limit: number };
      const results = await searchDrivers(q, limit);
      res.json(results);
    } catch (error) {
      res.status(500).json({ message: 'Error searching drivers', error });
    }
  },
);

/**
 * @openapi
 * /drivers/{id}/sub-drivers:
 *   get:
 *     summary: Get sub-drivers for a parent driver
 *     description: Returns all sub-drivers linked to the given parent driver ID.
 *     tags: [Drivers]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: The parent driver's database ID.
 *         schema:
 *           type: integer
 *           minimum: 1
 *         example: 5
 *     responses:
 *       200:
 *         description: Sub-drivers for the given parent (may be an empty array).
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/SubDriverResult'
 *       400:
 *         description: Invalid driver ID format.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       401:
 *         description: Missing or invalid JWT.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: Driver with the given ID does not exist.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       429:
 *         description: Rate limit exceeded.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       500:
 *         description: Server error.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
drivers.get(
  '/:id/sub-drivers',
  limitDriversRead,
  requireRole(['Admin', 'Editor', 'Viewer']),
  validate({ params: getSubDriversParamsSchema }),
  async (req: Request, res: Response) => {
    try {
      // id is already coerced to number by the validation middleware
      const { id } = req.params as unknown as { id: number };
      const subDrivers = await getSubDrivers(id);
      res.json(subDrivers);
    } catch (error: unknown) {
      const status = (error as { status?: number }).status;
      if (status === 404) {
        return res.status(404).json({ message: (error as Error).message });
      }
      res.status(500).json({ message: 'Error fetching sub-drivers', error });
    }
  },
);

export default drivers;
