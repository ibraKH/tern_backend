import { z } from 'zod'
;

// GET /models/all
export const getAllModelsSchema = z.object
({});

// GET /models/:name
export const getModelByNameSchema = z.object
({
  name: z.string().min(1, 'model name is required'
)
});

export type GetAllModelsQuery = z.infer<typeof getAllModelsSchema>;
export type GetModelByNameParams = z.infer<typeof getModelByNameSchema>;