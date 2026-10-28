import type { NextFunction, Request, Response } from "express";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { logger } from "../logger.js";
import { publicErrorMessage } from "../lib/user-errors.js";

/** Typed API error with HTTP status. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "API_ERROR",
  ) {
    super(message);
  }
}

/** Validate a request segment against a zod schema; throws 400 on failure. */
export function validate<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new ApiError(400, `Validation failed — ${detail}`, "VALIDATION_ERROR");
  }
  return result.data;
}

/** Async route wrapper so thrown errors reach the error handler. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

/** Final error handler — uniform JSON envelope, no stack leakage. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    const message = publicErrorMessage(err.code, err.message);
    if (message !== err.message) {
      logger.warn({ code: err.code, internal: err.message, path: req.path }, "sanitized api error");
    }
    res.status(err.status).json({ error: { code: err.code, message } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: err.message } });
    return;
  }
  logger.error({ err, path: req.path }, "unhandled error");
  res.status(500).json({ error: { code: "INTERNAL", message: "Internal server error" } });
}
