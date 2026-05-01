import type { Request, Response } from 'express';
import express from 'express';
import { saveModel, flagAsTemplate, cloneFromTemplate } from '../services/models/save.service';
import { getAllModels, getModelByName, getTemplates } from '../services/models/show.service';
import { removeModelByName,removeState,removeTransitionByBusinessId } from '../services/models/remove.service';
import { assertModelUnlocked, getModelLockStatus, lockModelForReview, unlockModelForReview } from '../services/models/reviewLock.service';
import { requireRole } from '../middlewares/role.middleware';
import { requireModelRole } from '../middlewares/model-permission.middleware';
import { getAllModelsSchema, getModelByNameSchema } from '../validation/models.validation';
import { validate } from '../validation/validate';
import { logActivity } from '../services/collab/activity.service';
import { broadcastActivity } from '../collab/roomManager';
import { io } from '../socket';

type AuthedRequest = Request & { user?: { id: number; email: string; role: string; contributor_id: number | null } };
import { limitModelsRead, limitModelsWrite } from '../middlewares/rateLimit';

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
 *         is_template:
 *           type: boolean
 *           nullable: true
 *           description: Whether this model is a template that can be cloned
 *         is_locked:
 *           type: boolean
 *           nullable: true
 *           description: Whether the model has been permanently review-locked
 *         locked_by:
 *           type: string
 *           nullable: true
 *         locked_at:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         lock_reason:
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
models.get('/all', limitModelsRead, requireRole(["Admin"]), validate({ params: getAllModelsSchema }), async (req: Request, res: Response) => {
  try {
    const modelNames = await getAllModels();
    res.json(modelNames);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error fetching model names', error });
  }
});

// GET /models/templates: Get all template model names
/**
 * @openapi
 * /models/templates:
 *   get:
 *     summary: List all template models
 *     description: Returns an array of `stm_name` values for all models marked as templates, ordered by name.
 *     tags: [Models]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Array of template model names.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: string
 *             example:
 *               - "Template Model A"
 *               - "Template Model B"
 *       401:
 *         description: Missing/invalid token.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       500:
 *         description: Server error.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
models.get('/templates', limitModelsRead, async (req: Request, res: Response) => {
  try {
    const templates = await getTemplates();
    res.json(templates);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error fetching templates', error });
  }
});

models.get('/:name/review-lock', limitModelsRead, requireRole(["Admin", "Editor", "Viewer"]), async (req: Request, res: Response) => {
  try {
    const { name } = req.params as { name: string };
    const status = await getModelLockStatus(name);
    if (!status) {
      return res.status(404).json({ message: `Model with name '${name}' not found` });
    }
    return res.json(status);
  } catch (error: unknown) {
    const status = error && typeof error === 'object' && 'status' in error ? (error as { status: number }).status : 500;
    const message = error && typeof error === 'object' && 'message' in error ? (error as { message: string }).message : 'Error fetching review lock status';
    return res.status(status).json({ message });
  }
});

models.post('/:name/review-lock', limitModelsWrite, requireRole(["Admin"]), async (req: Request, res: Response) => {
  try {
    const { name } = req.params as { name: string };
    const user = (req as AuthedRequest).user;
    const { reason } = req.body as { reason?: string };
    const status = await lockModelForReview(name, user?.email ?? '', reason);
    return res.json({ success: true, ...status });
  } catch (error: unknown) {
    const status = error && typeof error === 'object' && 'status' in error ? (error as { status: number }).status : 500;
    const message = error && typeof error === 'object' && 'message' in error ? (error as { message: string }).message : 'Error locking model for review';
    return res.status(status).json({ message });
  }
});

models.delete('/:name/review-lock', limitModelsWrite, requireRole(["Admin"]), async (req: Request, res: Response) => {
  try {
    const { name } = req.params as { name: string };
    const status = await unlockModelForReview(name);
    return res.json({ success: true, ...status });
  } catch (error: unknown) {
    const status = error && typeof error === 'object' && 'status' in error ? (error as { status: number }).status : 500;
    const message = error && typeof error === 'object' && 'message' in error ? (error as { message: string }).message : 'Error unlocking model for review';
    return res.status(status).json({ message });
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
models.get('/:name', limitModelsRead, requireRole(["Admin", "Editor", "Viewer"]), requireModelRole(['viewer', 'editor', 'reviewer']), validate({ params: getModelByNameSchema }), async (req: Request, res: Response) => {
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

// POST /models/from-template/:name: Clone a template into a new model
/**
 * @openapi
 * /models/from-template/{name}:
 *   post:
 *     summary: Clone a template into a new model
 *     description: >
 *       Creates a new model by deep-copying all states, transitions, and causal chains from the specified template.
 *       The new model is not marked as a template and is owned by the requesting user.
 *     tags: [Models]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         description: The `stm_name` of the template model to clone.
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [new_name]
 *             properties:
 *               new_name:
 *                 type: string
 *                 description: The name for the newly cloned model.
 *           example: { new_name: "My Custom Model" }
 *     responses:
 *       201:
 *         description: Model cloned successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 modelId:
 *                   type: integer
 *                 stm_name:
 *                   type: string
 *             example:
 *               success: true
 *               modelId: 456
 *               stm_name: "My Custom Model"
 *       400:
 *         description: Invalid request (missing new_name, duplicate model name, etc.).
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       401:
 *         description: Missing/invalid token.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       403:
 *         description: Forbidden (requires authenticated user).
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: Template not found.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       500:
 *         description: Server error.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
models.post('/from-template/:name', limitModelsWrite, requireRole(["Admin", "Editor"]), async (req: Request, res: Response) => {
  try {
    const { name } = req.params as { name: string };
    const { new_name } = req.body;
    const user = (req as AuthedRequest).user;

    if (!new_name || typeof new_name !== 'string' || new_name.trim() === '') {
      return res.status(400).json({ message: 'new_name is required and must be a non-empty string' });
    }

    const result = await cloneFromTemplate(name, new_name, user?.contributor_id ?? null, user?.email);
    res.status(201).json({ success: true, ...result });

    // Log activity
    if (user) {
      void logActivity({
        modelName: new_name,
        userId: user.id,
        action: 'model_cloned_from_template',
        detail: { sourceTemplate: name, newModelId: result.modelId }
      });
    }
  } catch (error: unknown) {
    const status = error && typeof error === 'object' && 'status' in error ? (error as { status: number }).status : 500;
    const message = error && typeof error === 'object' && 'message' in error ? (error as { message: string }).message : String(error);
    res.status(status).json({ message });
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
models.post('/save', limitModelsWrite, requireRole(["Admin", "Editor"]), requireModelRole(['editor']), async (req, res) => {
  try {
    const modelId = await saveModel(req.body);
    res.status(201).json({ success: true, modelId });

    // Fire-and-forget activity logging after successful save.
    const user = (req as AuthedRequest).user;
    const stmName = req.body?.stm_name as string | undefined;
    if (user && stmName) {
      const roomKey = `name:${stmName}`;
      const entry = {
        id: 0, action: 'model_saved', entityType: null, entityId: null,
        detail: { modelId }, createdAt: new Date().toISOString(),
        user: { id: user.id, email: user.email },
      };
      void logActivity({ modelName: stmName, userId: user.id, action: 'model_saved', detail: { modelId } });
      try { broadcastActivity(io, roomKey, entry); } catch { /* Socket.IO may not be initialized in tests */ }
    }
  } catch (error : unknown) {
    const status = error && typeof error === 'object' && 'status' in error ? (error as { status: number }).status : 500;
    const message = error && typeof error === 'object' && 'message' in error ? (error as { message: string }).message : 'Error saving model';
    res.status(status).json({ message });
  }
});

// DELETE /models/:name:
/**
 * @openapi
 * /models/{name}:
 *   delete:
 *     summary: Delete a whole model by name (cascading)
 *     description: >
 *       Deletes the model identified by `stm_name` and **all** related data (states, transitions,
 *       causal chains, method_causal_chain, and model_contributions) in a single transaction.
 *       Returns the deleted model's internal ID.
 *     tags: [Models]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         description: The `stm_name` (model name) to delete.
 *         schema:
 *           type: string
 *         example: "BMRG Rainforests"
 *     responses:
 *       200:
 *         description: Model deleted successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 deletedModelId:
 *                   type: integer
 *             example:
 *               success: true
 *               deletedModelId: 42
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
models.delete('/:name', limitModelsWrite, requireRole(["Admin"]), async (req: Request, res: Response) => {
  try {
    const { name } = req.params as { name: string };
    await assertModelUnlocked(name);

    // Log activity before delete (model will be gone after).
    const user = (req as AuthedRequest).user;
    if (user) {
      void logActivity({ modelName: name, userId: user.id, action: 'model_deleted' });
    }

    const r = await removeModelByName(name);
    res.json({ success: true, ...r });
  } catch (error: unknown) {
    const status = error && typeof error === 'object' && 'status' in error ? (error as { status: number }).status : 500;
    const message = error && typeof error === 'object' && 'message' in error ? (error as { message: string }).message : 'Error removing model';
    res.status(status).json({ message });
  }
});

// DELETE /models/:name/states/:stateId:
/**
 * @openapi
 * /models/{name}/states/{stateId}:
 *   delete:
 *     summary: Delete one state by ID within a model
 *     description: >
 *       Deletes the specified state **and** any transitions that start or end at that state,
 *       along with related causal_chain and method_causal_chain rows. Operates in a transaction.
 *     tags: [Models]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         description: The `stm_name` that owns the state.
 *         schema:
 *           type: string
 *         example: "BMRG Rainforests"
 *       - in: path
 *         name: stateId
 *         required: true
 *         description: The **DB** ID of the state to delete.
 *         schema:
 *           type: integer
 *           minimum: 1
 *         example: 101
 *     responses:
 *       200:
 *         description: State deleted successfully (and related data cleaned up).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *             example:
 *               success: true
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
 *       404:
 *         description: State not found in the specified model.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       500:
 *         description: Server error.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
models.delete('/:name/states/:stateId', limitModelsWrite, requireRole(["Admin", "Editor"]), requireModelRole(['editor']), async (req: Request, res: Response) => {
  try {
    const { name, stateId } = req.params as { name: string; stateId: string };
    await assertModelUnlocked(name);
    await removeState(name, Number(stateId));
    res.json({ success: true });

    const user = (req as AuthedRequest).user;
    if (user) {
      const roomKey = `name:${name}`;
      void logActivity({ modelName: name, userId: user.id, action: 'node_deleted', entityType: 'node', entityId: Number(stateId) });
      try {
        broadcastActivity(io, roomKey, {
          id: 0, action: 'node_deleted', entityType: 'node', entityId: Number(stateId),
          detail: null, createdAt: new Date().toISOString(), user: { id: user.id, email: user.email },
        });
      } catch { /* no-op if io not initialized */ }
    }
  } catch (error: unknown) {
    const status = error && typeof error === 'object' && 'status' in error ? (error as { status: number }).status : 500;
    const message = error && typeof error === 'object' && 'message' in error ? (error as { message: string }).message : 'Error removing state';
    res.status(status).json({ message });
  }
});

// DELETE /models/:name/transitions/:transitionId:
/**
 * @openapi
 * /models/{name}/transitions/{transitionId}:
 *   delete:
 *     summary: Delete one transition by business ID within a model
 *     description: >
 *       Deletes the transition identified by `transition_id` (business ID) within the given model,
 *       and cleans up related causal_chain and method_causal_chain rows. Operates in a transaction.
 *     tags: [Models]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         description: The `stm_name` that owns the transition.
 *         schema:
 *           type: string
 *         example: "BMRG Rainforests"
 *       - in: path
 *         name: transitionId
 *         required: true
 *         description: The **business** transition ID (not the DB PK) to delete.
 *         schema:
 *           type: integer
 *           minimum: 1
 *         example: 305
 *     responses:
 *       200:
 *         description: Transition deleted successfully (and related data cleaned up).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *             example:
 *               success: true
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
 *       404:
 *         description: Transition not found in the specified model.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       500:
 *         description: Server error.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
models.delete('/:name/transitions/:transitionId', limitModelsWrite, requireRole(["Admin", "Editor"]), requireModelRole(['editor']), async (req: Request, res: Response) => {
  try {
    const { name, transitionId } = req.params as { name: string; transitionId: string };
    await assertModelUnlocked(name);
    await removeTransitionByBusinessId(name, Number(transitionId));
    res.json({ success: true });

    const user = (req as AuthedRequest).user;
    if (user) {
      const roomKey = `name:${name}`;
      void logActivity({ modelName: name, userId: user.id, action: 'edge_deleted', entityType: 'edge', entityId: Number(transitionId) });
      try {
        broadcastActivity(io, roomKey, {
          id: 0, action: 'edge_deleted', entityType: 'edge', entityId: Number(transitionId),
          detail: null, createdAt: new Date().toISOString(), user: { id: user.id, email: user.email },
        });
      } catch { /* no-op */ }
    }
  } catch (error: unknown) {
    const status = error && typeof error === 'object' && 'status' in error ? (error as { status: number }).status : 500;
    const message = error && typeof error === 'object' && 'message' in error ? (error as { message: string }).message : 'Error removing transition';
    res.status(status).json({ message });
  }
});

// PATCH /models/:name/template: Flag/unflag a model as template
/**
 * @openapi
 * /models/{name}/template:
 *   patch:
 *     summary: Flag or unflag a model as a template
 *     description: >
 *       Sets or clears the is_template flag on a model.
 *       Only the model's owner (determined by model contributors) or an Admin can perform this action.
 *     tags: [Models]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         description: The `stm_name` of the model to update.
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [flag]
 *             properties:
 *               flag:
 *                 type: boolean
 *                 description: Whether to mark as template (true) or remove template status (false).
 *           example: { flag: true }
 *     responses:
 *       200:
 *         description: Template flag updated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *             example:
 *               success: true
 *       401:
 *         description: Missing/invalid token.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       403:
 *         description: Forbidden. Admin or model owner required.
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
models.patch('/:name/template', limitModelsWrite, async (req: Request, res: Response) => {
  try {
    const { name } = req.params as { name: string };
    const { flag } = req.body;
    const user = (req as AuthedRequest).user;

    await assertModelUnlocked(name);
    await flagAsTemplate(name, flag, user?.role ?? '', user?.email ?? '');
    res.json({ success: true });

    if (user) {
      void logActivity({ modelName: name, userId: user.id, action: 'template_flag_updated', detail: { flag } });
    }
  } catch (error: unknown) {
    const status = error && typeof error === 'object' && 'status' in error ? (error as { status: number }).status : 500;
    const message = error && typeof error === 'object' && 'message' in error ? (error as { message: string }).message : String(error);
    res.status(status).json({ message });
  }
});

export default models;
