import type { Request, Response } from 'express';
import express from 'express';
import { saveModel, cloneFromTemplate } from '../services/models/save.service';
import { getAllModels, getAssignedModels, getModelByName, getTemplates } from '../services/models/show.service';
import { removeModelByName, removeState, removeTransitionByBusinessId } from '../services/models/remove.service';
import { assertModelUnlocked, getModelLockStatus, lockModelForReview, unlockModelForReview } from '../services/models/reviewLock.service';
import { requireRole } from '../middlewares/role.middleware';
import { requireAdmin } from '../middlewares/requireAdmin';
import { requireModelRole } from '../middlewares/model-permission.middleware';
import { getAllModelsSchema, getModelByNameSchema } from '../validation/models.validation';
import { validate } from '../validation/validate';
import { logActivity } from '../services/collab/activity.service';
import { broadcastActivity } from '../collab/roomManager';
import { io } from '../socket';
import { GLOBAL_ROLES, MODEL_ROLES } from '../constants/roles';

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
 *     tags: [Models]
 *     responses:
 *       200:
 *         description: Service is healthy
 */
models.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'Models service is healthy' });
});

/**
 * @openapi
 * /models/all:
 *   get:
 *     summary: List accessible model names
 *     description: >
 *       Admins receive all non-template models. All other authenticated users receive
 *       only models they have a model_permissions row for. Templates are never included.
 *     tags: [Models]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Array of model names.
 *       401:
 *         description: Missing/invalid token.
 *       500:
 *         description: Server error.
 */
models.get('/all', limitModelsRead, requireRole([GLOBAL_ROLES.ADMIN, GLOBAL_ROLES.EDITOR, GLOBAL_ROLES.VIEWER]), validate({ params: getAllModelsSchema }), async (req: Request, res: Response) => {
  try {
    const user = (req as AuthedRequest).user!;
    const userEmail = user.role === GLOBAL_ROLES.ADMIN ? undefined : user.email;
    const modelNames = await getAllModels(userEmail);
    res.json(modelNames);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error fetching model names', error });
  }
});

/**
 * @openapi
 * /models/assigned:
 *   get:
 *     summary: List models assigned to the requesting user with their model role
 *     description: >
 *       Returns all non-template models the user has any model_permissions row for,
 *       along with the user's model role. Covers owners, editors, reviewers, and viewers.
 *     tags: [Models]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Assigned models with model roles.
 *       401:
 *         description: Missing/invalid token.
 *       500:
 *         description: Server error.
 */
// Registered before /:name to avoid param collision.
models.get('/assigned', limitModelsRead, async (req: Request, res: Response) => {
  try {
    const user = (req as AuthedRequest).user!;
    const modelsList = await getAssignedModels(user.email);
    res.json({ models: modelsList });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error fetching assigned models', error });
  }
});

// GET /models/templates
// requireAuth is enforced at the app level (app.use('/models', requireAuth, ...)).
// No role check is needed — all authenticated users may view templates.
/**
 * @openapi
 * /models/templates:
 *   get:
 *     summary: List all template models
 *     tags: [Models]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Array of template model names.
 *       401:
 *         description: Missing/invalid token.
 *       500:
 *         description: Server error.
 */
models.get('/templates', limitModelsRead, async (_req: Request, res: Response) => {
  try {
    const templates = await getTemplates();
    res.json(templates);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error fetching templates', error });
  }
});

// Review-lock routes — Admin-only write; model-role-gated read.
models.get(
  '/:name/review-lock',
  limitModelsRead,
  requireModelRole([MODEL_ROLES.OWNER, MODEL_ROLES.EDITOR, MODEL_ROLES.REVIEWER, MODEL_ROLES.VIEWER]),
  async (req: Request, res: Response) => {
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
  },
);

models.post('/:name/review-lock', limitModelsWrite, requireAdmin, async (req: Request, res: Response) => {
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

models.delete('/:name/review-lock', limitModelsWrite, requireAdmin, async (req: Request, res: Response) => {
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

/**
 * @openapi
 * /models/{name}:
 *   get:
 *     summary: Get model by name
 *     tags: [Models]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Model details.
 *       401:
 *         description: Missing/invalid token.
 *       403:
 *         description: Forbidden.
 *       404:
 *         description: Model not found.
 *       500:
 *         description: Server error.
 */
models.get(
  '/:name',
  limitModelsRead,
  requireRole([GLOBAL_ROLES.ADMIN, GLOBAL_ROLES.EDITOR, GLOBAL_ROLES.VIEWER]),
  requireModelRole([MODEL_ROLES.VIEWER, MODEL_ROLES.EDITOR, MODEL_ROLES.REVIEWER]),
  validate({ params: getModelByNameSchema }),
  async (req: Request, res: Response) => {
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
  },
);

// POST /models/from-template/:name
models.post(
  '/from-template/:name',
  limitModelsWrite,
  requireRole([GLOBAL_ROLES.ADMIN, GLOBAL_ROLES.EDITOR]),
  async (req: Request, res: Response) => {
    try {
      const { name } = req.params as { name: string };
      const { new_name } = req.body;
      const user = (req as AuthedRequest).user;

      if (!new_name || typeof new_name !== 'string' || new_name.trim() === '') {
        return res.status(400).json({ message: 'new_name is required and must be a non-empty string' });
      }

      const result = await cloneFromTemplate(name, new_name, user?.contributor_id ?? null, user?.email);
      res.status(201).json({ success: true, ...result });

      if (user) {
        void logActivity({
          modelName: new_name, userId: user.id, action: 'model_cloned_from_template',
          detail: { sourceTemplate: name, newModelId: result.modelId },
        });
      }
    } catch (error: unknown) {
      const status = error && typeof error === 'object' && 'status' in error ? (error as { status: number }).status : 500;
      const message = error && typeof error === 'object' && 'message' in error ? (error as { message: string }).message : String(error);
      res.status(status).json({ message });
    }
  },
);

// POST /models/save
models.post(
  '/save',
  limitModelsWrite,
  requireRole([GLOBAL_ROLES.ADMIN, GLOBAL_ROLES.EDITOR]),
  requireModelRole([MODEL_ROLES.EDITOR]),
  async (req, res) => {
    try {
      const user = (req as AuthedRequest).user!;
      const modelId = await saveModel(req.body, user.email);
      res.status(201).json({ success: true, ...modelId });

      const stmName = req.body?.stm_name as string | undefined;
      if (stmName) {
        const roomKey = `name:${stmName}`;
        const entry = {
          id: 0, action: 'model_saved', entityType: null, entityId: null,
          detail: { modelId }, createdAt: new Date().toISOString(),
          user: { id: user.id, email: user.email },
        };
        void logActivity({ modelName: stmName, userId: user.id, action: 'model_saved', detail: { modelId } });
        try { broadcastActivity(io, roomKey, entry); } catch { /* Socket.IO may not be initialized in tests */ }
      }
    } catch (error: unknown) {
      const status = error && typeof error === 'object' && 'status' in error ? (error as { status: number }).status : 500;
      const message = error && typeof error === 'object' && 'message' in error ? (error as { message: string }).message : 'Error saving model';
      res.status(status).json({ message });
    }
  },
);

// DELETE /models/:name
models.delete(
  '/:name',
  limitModelsWrite,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const { name } = req.params as { name: string };
      await assertModelUnlocked(name);

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
  },
);

// DELETE /models/:name/states/:stateId
models.delete(
  '/:name/states/:stateId',
  limitModelsWrite,
  requireRole([GLOBAL_ROLES.ADMIN, GLOBAL_ROLES.EDITOR]),
  requireModelRole([MODEL_ROLES.EDITOR]),
  async (req: Request, res: Response) => {
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
  },
);

// DELETE /models/:name/transitions/:transitionId
models.delete(
  '/:name/transitions/:transitionId',
  limitModelsWrite,
  requireRole([GLOBAL_ROLES.ADMIN, GLOBAL_ROLES.EDITOR]),
  requireModelRole([MODEL_ROLES.EDITOR]),
  async (req: Request, res: Response) => {
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
  },
);

export default models;
