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

export const driverSchema = z.object({
  name: z.string(),
  description: z.string(),
  category: z.string(),
});

export const subDriverSchema = z.object({
  name: z.string(),
  description: z.string(),
});

export const driverJSONSchema = z.array(
  driverSchema.extend({
    sub_drivers: z.array(subDriverSchema),
  })
);

export const stmModelSchema = z.object({
  name: z.string(),
  // Add other STM model fields here as needed
});

export function validateDriverJSON(data: unknown) {
  driverJSONSchema.parse(data);
}

export function validateSTMModel(data: unknown) {
  stmModelSchema.parse(data);
}