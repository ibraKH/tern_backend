import type { Request, Response, NextFunction } from "express";
import type { ZodError, ZodIssue, ZodTypeAny } from "zod";
import { ValidationError } from "../errors";
import { z } from 'zod';

type Section = "body" | "params" | "query";

interface Schemas {
  body?: ZodTypeAny;
  params?: ZodTypeAny;
  query?: ZodTypeAny;
}

type ValidationDetail = {
  section: Section;
  path: string;
  message: string;
  code: ZodIssue["code"];
  expected?: unknown;
  received?: unknown;
};

function issuesToDetails(section: Section, issues: ZodIssue[]): ValidationDetail[] {
  return issues.map((i) => {
    const base: ValidationDetail = {
      section,
      path: Array.isArray(i.path) ? i.path.join(".") : "",
      message: i.message,
      code: i.code,
    };

    if (i.code === "invalid_type" && "expected" in i && "received" in i) {
      return { ...base, expected: i.expected, received: i.received };
    }
    return base;
  });
}

function isZodError(err: unknown): err is ZodError {
  return typeof err === "object" && err !== null && "issues" in err;
}

export function validate(schemas: Schemas) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const details: ValidationDetail[] = [];

    const parseSection = async <T>(
      section: Section,
      schema: ZodTypeAny | undefined,
      value: unknown
    ): Promise<T | undefined> => {
      if (!schema) return undefined;
      const result = await schema.safeParseAsync(value);
      if (!result.success) {
        details.push(...issuesToDetails(section, result.error.issues));
        return undefined;
      }
      return result.data as T;
    };

    try {
      const [bodyParsed, paramsParsed, queryParsed] = await Promise.all([
        parseSection("body", schemas.body, req.body),
        parseSection("params", schemas.params, req.params),
        parseSection("query", schemas.query, req.query),
      ]);

      if (details.length) {
        return next(new ValidationError(details));
      }

      if (bodyParsed !== undefined) req.body = bodyParsed;
      if (paramsParsed !== undefined) {
        req.params = paramsParsed as typeof req.params;
      }
      if (queryParsed !== undefined) {
        // Express 5 defines req.query as a read-only getter on the prototype.
        // Direct assignment throws TypeError in strict mode, so we override it
        // on the request instance using defineProperty instead.
        Object.defineProperty(req, 'query', {
          value: queryParsed,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      }

      return next();
    } catch (err: unknown) {
      if (isZodError(err)) {
        return next(new ValidationError(issuesToDetails("body", err.issues)));
      }
      return next(err as Error);
    }
  };
}

// ─────────────────────────────────────────────
// Admin upload schemas
// ─────────────────────────────────────────────

const driverUploadItemSchema = z.object({
  name: z.string().min(1, 'name is required'),
  description: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  sub_drivers: z
    .array(
      z.object({
        name: z.string().min(1, 'sub_drivers.name is required'),
        description: z.string().optional().nullable(),
      })
    )
    .optional(),
});

const driverUploadJsonSchema = z.array(driverUploadItemSchema);

/**
 * Backwards-compatible export name used by the admin driver upload service.
 */
export function validateDriverJSON(data: unknown) {
  return driverUploadJsonSchema.parse(data);
}

// Template upload should match (at least) the top-level structure required by saveModel().
// The JSON is described as "same shape as GET /models/:name" which maps to BMRGData.
const contributorSchema = z.object({
  contributor_id: z.number().int().positive().optional(),
  name: z.string().min(1),
  email: z.string().email(),
  contribution_type: z.enum(['Author', 'Reviewer']),
}).passthrough();

const stateAttributeSchema = z.object({
  state_attribute_id: z.number().int().positive().optional(),
  attribute_type: z.string().min(1),
  value: z.union([z.number(), z.string()]),
  units: z.string().optional().nullable(),
}).passthrough();

const vastStateSchema = z.object({
  vast_state_id: z.number().int().positive().optional(),
  vast_class: z.string().optional().nullable(),
  vast_name: z.string().optional().nullable(),
  eks_overstorey_class: z.string().optional().nullable(),
  eks_understorey_class: z.string().optional().nullable(),
  eks_substate: z.string().optional().nullable(),
  link: z.string().optional().nullable(),
}).passthrough();

const stateSchema = z.object({
  state_id: z.number().int().positive().optional(),
  frontend_state_id: z.number().int().positive().optional(),
  state_name: z.string().min(1),
  vast_state: vastStateSchema.optional().nullable(),
  condition_upper: z.number().optional().nullable(),
  condition_lower: z.number().optional().nullable(),
  eks_condition_estimate: z.number().optional().nullable(),
  elicitation_type: z.enum(['Pilot region', 'NEAP estimate']).optional().nullable(),
  node_x: z.number().optional().nullable(),
  node_y: z.number().optional().nullable(),
  attributes: z.array(stateAttributeSchema).optional().default([]),
}).passthrough();

const chainDriverSchema = z.object({
  driver_id: z.number().int().positive().optional(),
  driver: z.string().min(1),
  description: z.string().optional().nullable(),
  driver_group: z.string().optional().nullable(),
}).passthrough();

const causalChainSchema = z.object({
  causal_chain_id: z.number().int().positive().optional(),
  name: z.string().optional().nullable(),
  chain_part: z.string().optional().nullable(),
  drivers: z.array(chainDriverSchema).optional().default([]),
}).passthrough();

const transitionSchema = z.object({
  id: z.number().int().positive().optional(),
  transition_id: z.number().int().positive().optional().nullable(),
  stm_name: z.string().optional().nullable(),
  start_state_id: z.number().int(),
  end_state_id: z.number().int(),
  time_25: z.number().optional().nullable(),
  time_100: z.number().optional().nullable(),
  likelihood_25: z.number().optional().nullable(),
  likelihood_100: z.number().optional().nullable(),
  notes: z.string().optional().nullable(),
  causal_chain: z.array(causalChainSchema).optional().default([]),
  transition_delta: z.number().optional().nullable(),
}).passthrough();

const stmModelUploadSchema = z
  .object({
    // GET /models/:name uses stm_name, but the PR description mentions name.
    stm_name: z.string().min(1).optional(),
    name: z.string().min(1).optional(),

    // Core metadata required by saveModel() / upsertModelMetadata()
    version: z.string().min(1),
    release_date: z.string().min(1),
    authorised_by: z.string().min(1),
    contributing_experts: z.array(contributorSchema),
    region: z.string().min(1),
    region_id: z.number().int(),
    climate: z.string().min(1),
    ecosystem_type: z.string().min(1),
    aus_eco_archetype_code: z.union([z.number().int(), z.string().transform((v) => Number(v))]),
    aus_eco_archetype_name: z.string().min(1),
    aus_eco_umbrella_code: z.union([z.number().int(), z.string().transform((v) => Number(v))]),
    peer_reviewed: z.string().min(1),
    no_peer_reviewers: z.number().int(),

    states: z.array(stateSchema),
    transitions: z.array(transitionSchema),
  })
  .passthrough()
  .refine((v) => typeof v.stm_name === 'string' || typeof v.name === 'string', {
    message: 'Model name is required (stm_name or name)',
    path: ['stm_name'],
  });

/**
 * Backwards-compatible export name used by the admin template upload service.
 */
export function validateSTMModel(data: unknown) {
  return stmModelUploadSchema.parse(data);
}