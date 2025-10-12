import type { Request, Response } from 'express';
import express from 'express';
import { saveModel } from '../services/models/save.service';
import { getAllModels, getModelByName } from '../services/models/show.service';
import { requireRole } from '../middlewares/role.middleware';

const models = express.Router();
/**
 * @openapi
 * tags:
 *   - name: Models
 *     description: Endpoints for managing TERN STM models
 *
 * components:
 *   securitySchemes:
 *     BearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *
 *   schemas:
 *     ErrorResponse:
 *       type: object
 *       properties:
 *         message:
 *           type: string
 *         error:
 *           nullable: true
 *
 *     Contributor:
 *       type: object
 *       required: [name, email, contribution_type]
 *       properties:
 *         contributor_id:
 *           type: integer
 *         name:
 *           type: string
 *         email:
 *           type: string
 *           format: email
 *         contribution_type:
 *           type: string
 *           enum: [Author, Reviewer]
 *
 *     VastState:
 *       type: object
 *       properties:
 *         vast_state_id:
 *           type: integer
 *         vast_class:
 *           type: string
 *           enum: [ClassI, ClassII, ClassIII, ClassIV, ClassV, ClassVI]
 *         vast_name:
 *           type: string
 *           nullable: true
 *         vast_eks_state:
 *           type: number
 *           nullable: true
 *         eks_overstorey_class:
 *           type: string
 *           nullable: true
 *         eks_understorey_class:
 *           type: string
 *           nullable: true
 *         eks_substate:
 *           type: string
 *           nullable: true
 *         link:
 *           type: string
 *           nullable: true
 *
 *     StateAttribute:
 *       type: object
 *       required: [attribute_type, value]
 *       properties:
 *         state_attribute_id:
 *           type: integer
 *         attribute_type:
 *           type: string
 *           description: Must match DB enum attribute_types
 *         value:
 *           oneOf:
 *             - type: number
 *             - type: string
 *             - type: "null"
 *         units:
 *           type: string
 *           nullable: true
 *
 *     StateData:
 *       type: object
 *       required: [state_name]
 *       properties:
 *         state_id:
 *           type: integer
 *         state_name:
 *           type: string
 *         vast_state:
 *           $ref: '#/components/schemas/VastState'
 *         condition_upper:
 *           type: number
 *           nullable: true
 *         condition_lower:
 *           type: number
 *           nullable: true
 *         eks_condition_estimate:
 *           type: number
 *           nullable: true
 *         elicitation_type:
 *           type: string
 *           enum: ['Pilot region', 'NEAP estimate']
 *           nullable: true
 *         attributes:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/StateAttribute'
 *
 *     ChainDriver:
 *       type: object
 *       required: [driver]
 *       properties:
 *         driver_id:
 *           type: integer
 *         driver:
 *           type: string
 *         description:
 *           type: string
 *           nullable: true
 *         driver_group:
 *           type: string
 *           nullable: true
 *
 *     CausalChain:
 *       type: object
 *       properties:
 *         causal_chain_id:
 *           type: integer
 *         name:
 *           type: string
 *           nullable: true
 *         chain_part:
 *           type: string
 *           enum: ['Management Intervention','Favorable abiotic factor','Biotic process','Hazard']
 *           nullable: true
 *         driver_id:
 *           type: integer
 *         drivers:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/ChainDriver'
 *
 *     TransitionData:
 *       type: object
 *       required: [start_state_id, end_state_id]
 *       properties:
 *         id:
 *           type: integer
 *         transition_id:
 *           type: integer
 *           nullable: true
 *         stm_name:
 *           type: string
 *         start_state:
 *           type: string
 *           nullable: true
 *         start_state_id:
 *           type: integer
 *         end_state:
 *           type: string
 *           nullable: true
 *         end_state_id:
 *           type: integer
 *         time_25:
 *           type: number
 *           nullable: true
 *         time_100:
 *           type: number
 *           nullable: true
 *         likelihood_25:
 *           type: number
 *           nullable: true
 *         likelihood_100:
 *           type: number
 *           nullable: true
 *         notes:
 *           type: string
 *           nullable: true
 *         causal_chain:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/CausalChain'
 *         transition_delta:
 *           type: number
 *           nullable: true
 *
 *     BMRGData:
 *       type: object
 *       required: [stm_name]
 *       properties:
 *         id:
 *           type: integer
 *         stm_name:
 *           type: string
 *         version:
 *           type: string
 *           nullable: true
 *         release_date:
 *           type: string
 *           nullable: true
 *         authorised_by:
 *           type: string
 *           nullable: true
 *         contributing_experts:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/Contributor'
 *         region:
 *           type: string
 *           nullable: true
 *         region_id:
 *           type: integer
 *           nullable: true
 *         climate:
 *           type: string
 *           nullable: true
 *         ecosystem_type:
 *           type: string
 *           nullable: true
 *         aus_eco_archetype_code:
 *           oneOf:
 *             - type: integer
 *             - type: string
 *           nullable: true
 *         aus_eco_archetype_name:
 *           type: string
 *           nullable: true
 *         aus_eco_umbrella_code:
 *           oneOf:
 *             - type: integer
 *             - type: string
 *           nullable: true
 *         peer_reviewed:
 *           oneOf:
 *             - type: boolean
 *             - type: string
 *           nullable: true
 *         no_peer_reviewers:
 *           type: integer
 *           nullable: true
 *         states:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/StateData'
 *         transitions:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/TransitionData'
 *         method_alignment:
 *           type: string
 *           nullable: true
 *
 *     SaveModelResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         modelId:
 *           type: integer
 *           example: 123
 */

// Health check endpoint
/**
 * @openapi
 * /models/health:
 *   get:
 *     security:
 *       - BearerAuth: []
 *     summary: Health check for the Models service
 *     description: Returns a simple status to verify the Models service is reachable.
 *     tags: [Models]
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "Models service is healthy"
 */
models.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'Models service is healthy' });
});

/**
 * @openapi
 * /models/all:
 *   get:
 *     summary: List all model names
 *     description: Returns an array of `stm_name` values ordered by name.
 *     tags: [Models]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Array of model names.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: string
 *             example:
 *               - "BMRG Rainforests"
 *               - "Savanna v1.2"
 *       401:
 *         description: Missing/invalid token.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       403:
 *         description: Forbidden (requires Admin role).
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       500:
 *         description: Server error.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
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
/**
 * @openapi
 * /models/{name}:
 *   get:
 *     summary: Get model by name
 *     description: Fetch a model’s full metadata by its `stm_name`, including states and transitions.
 *     tags: [Models]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         description: The `stm_name` value to look up.
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Model details.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/BMRGData' }
 *       401:
 *         description: Missing/invalid token.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       403:
 *         description: Forbidden (requires Admin/Editor/Viewer role).
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: Model not found.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       500:
 *         description: Server error.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
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
/**
 * @openapi
 * /models/save:
 *   post:
 *     summary: Save (create or update) a model
 *     description: >
 *       Upserts a model and its nested entities.  
 *       - If `id` is present in payload → updates `stmmodel` and nested items.  
 *       - If `stm_name` already exists on insert → returns 409 Conflict.  
 *       - `release_date` accepts "Aug-24" or ISO and is normalized server-side.
 *     tags: [Models]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/BMRGData' }
 *           example:
 *             stm_name: "BMRG Rainforests"
 *             version: "pre peer review"
 *             release_date: "Aug-24"
 *             authorised_by: "Megan Good"
 *             contributing_experts:
 *               - name: "Megan Good"
 *                 email: "megan.good@example.com"
 *                 contribution_type: "Author"
 *             region: "QLD"
 *             region_id: null
 *             climate: "Subtropical"
 *             ecosystem_type: "Rainforest"
 *             states: []
 *             transitions: []
 *     responses:
 *       201:
 *         description: Upsert successful.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SaveModelResponse' }
 *             example: { success: true, modelId: 123 }
 *       400:
 *         description: Invalid payload.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       401:
 *         description: Missing/invalid token.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       403:
 *         description: Forbidden (requires Admin or Editor role).
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409:
 *         description: Conflict (stm_name already exists on insert).
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       500:
 *         description: Failed to save model.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
models.post('/save', requireRole(["Admin", "Editor"]), async (req, res) => {
  try {
    const modelId = await saveModel(req.body);
    res.status(201).json({ success: true, modelId });
  } catch (error) {
    console.error('Error saving model:', error);
    res.status(500).json({ success: false, error: 'Failed to save model' });
  }
});

export default models;