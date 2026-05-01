import { z } from "zod";
import { AppError } from "../../errors";
import { saveModel, flagAsTemplate } from "../models/save.service";

type UploadInput = {
  buffer: Buffer;
  mimeType: string;
  originalName: string;
  actorEmail: string;
};

type UploadResult = {
  modelId: number;
  stm_name: string;
};

const contributionTypeEnum = z.enum(["Author", "Reviewer"]);

const contributorSchema = z
  .object({
    contributor_id: z.number().int().positive().optional(),
    id: z.number().int().positive().optional(),
    name: z.string().min(1),
    email: z.string().email(),
    contribution_type: contributionTypeEnum,
  })
  .passthrough();

const vastStateSchema = z
  .object({
    vast_state_id: z.number().int().positive().optional(),
    vast_class: z.string().optional().nullable(),
    vast_name: z.string().optional().nullable(),
    vast_eks_state: z.number().optional().nullable(),
    eks_overstorey_class: z.string().optional().nullable(),
    eks_understorey_class: z.string().optional().nullable(),
    eks_substate: z.string().optional().nullable(),
    link: z.string().optional().nullable(),
  })
  .passthrough();

const stateAttributeSchema = z
  .object({
    state_attribute_id: z.number().int().positive().optional(),
    attribute_type: z.string().min(1),
    value: z.union([z.number(), z.string(), z.null()]),
    units: z.string().optional().nullable(),
  })
  .passthrough();

const stateSchema = z
  .object({
    state_id: z.number().int().positive().optional(),
    frontend_state_id: z.number().int().positive().optional(),
    state_name: z.string().min(1),
    vast_state: vastStateSchema.optional().default({}),
    condition_upper: z.number().nullable().optional(),
    condition_lower: z.number().nullable().optional(),
    eks_condition_estimate: z.number().nullable().optional(),
    elicitation_type: z.enum(["Pilot region", "NEAP estimate"]).optional().nullable(),
    node_x: z.number().nullable().optional(),
    node_y: z.number().nullable().optional(),
    attributes: z.array(stateAttributeSchema).optional().default([]),
  })
  .passthrough();

const chainDriverSchema = z
  .object({
    driver_id: z.number().int().positive().optional(),
    driver: z.string().min(1),
    description: z.string().optional().nullable(),
    driver_group: z.string().optional().nullable(),
  })
  .passthrough();

const causalChainSchema = z
  .object({
    causal_chain_id: z.number().int().positive().optional(),
    name: z.string().optional().nullable(),
    chain_part: z
      .enum(["Management Intervention", "Favorable abiotic factor", "Biotic process", "Hazard"])
      .optional()
      .nullable(),
    drivers: z.array(chainDriverSchema).optional().default([]),
  })
  .passthrough();

const transitionSchema = z
  .object({
    id: z.number().int().positive().optional(),
    transition_id: z.union([z.number().int().positive(), z.null()]).optional(),
    stm_name: z.string().optional(),
    start_state: z.string().optional(),
    start_state_id: z.number().int(),
    end_state: z.string().optional(),
    end_state_id: z.number().int(),
    time_25: z.number().nullable().optional(),
    time_100: z.number().nullable().optional(),
    likelihood_25: z.number().nullable().optional(),
    likelihood_100: z.number().nullable().optional(),
    notes: z.string().nullable().optional(),
    causal_chain: z.array(causalChainSchema).optional().default([]),
    transition_delta: z.number().nullable().optional(),
  })
  .passthrough();

// Shape is aligned to GET /models/:name response produced by show.service.ts
const bmrgModelSchema = z
  .object({
    id: z.number().int().positive().optional(),
    stm_name: z.string().min(1),
    version: z.string().optional().nullable(),
    release_date: z.string().optional().nullable(),
    authorised_by: z.string().optional().nullable(),
    contributing_experts: z.array(contributorSchema).optional().default([]),
    region: z.string().optional().nullable(),
    region_id: z.union([z.number().int(), z.null()]).optional(),
    climate: z.string().optional().nullable(),
    ecosystem_type: z.string().optional().nullable(),
    aus_eco_archetype_code: z.union([z.number(), z.string(), z.null()]).optional(),
    aus_eco_archetype_name: z.string().optional().nullable(),
    aus_eco_umbrella_code: z.union([z.number(), z.string(), z.null()]).optional(),
    peer_reviewed: z.union([z.string(), z.boolean(), z.null()]).optional(),
    no_peer_reviewers: z.union([z.number().int(), z.null()]).optional(),
    states: z.array(stateSchema),
    transitions: z.array(transitionSchema),
    method_alignment: z.string().optional().nullable(),
    is_template: z.boolean().optional(),
  })
  .passthrough();

export async function uploadTemplateModel(input: UploadInput): Promise<UploadResult> {
  if (input.mimeType !== "application/json" && !input.originalName.toLowerCase().endsWith(".json")) {
    throw new AppError(400, "VALIDATION_ERROR", `Unsupported file type: ${input.mimeType}. Allowed: application/json`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.buffer.toString("utf8"));
  } catch (e) {
    throw new AppError(400, "VALIDATION_ERROR", `Malformed JSON: ${(e as Error).message}`);
  }

  const validated = bmrgModelSchema.safeParse(parsed);
  if (!validated.success) {
    throw new AppError(400, "VALIDATION_ERROR", "Template model JSON does not match expected schema", validated.error.flatten());
  }

  // Save (insert/update) using existing model save pipeline
  const { modelId } = await saveModel(validated.data as any);

  // Ensure template flag is set
  await flagAsTemplate(validated.data.stm_name, true, "Admin", input.actorEmail);

  return { modelId, stm_name: validated.data.stm_name };
}
