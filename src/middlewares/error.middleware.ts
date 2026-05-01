import type { ErrorRequestHandler } from "express";
import { MulterError } from "multer";
import type { ErrorCode } from "../errors";
import { AppError } from "../errors";

type ErrorResponse = {
  error: {
    code: ErrorCode;
    message: string;
    requestId?: string;
    details?: unknown;
    debug?: { name: string; stack?: string };
  };
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  // Multer upload errors (multipart/form-data)
  if (err instanceof MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      const appErr = new AppError(413, "PAYLOAD_TOO_LARGE", "file too large (max 5 MB)");
      err = appErr;
    } else {
      const appErr = new AppError(400, "VALIDATION_ERROR", `upload error: ${err.code}`);
      err = appErr;
    }
  }

  const isApp = err instanceof AppError;

  const status = isApp ? err.status : 500;
  const code: ErrorCode = isApp ? err.code : "INTERNAL_ERROR";
  const message = isApp ? err.message : "internal server error";

  const requestId = req.id;

  const response: ErrorResponse = {
    error: { code, message, requestId },
  };

  if (isApp && err.details !== undefined) {
    response.error.details = err.details;
  }

  if (process.env.NODE_ENV !== "production" && !isApp) {
    const name = (err as { name?: string })?.name ?? "Error";
    const stack = (err as { stack?: string })?.stack;
    response.error.debug = { name, stack };
  }

  res.status(status).json(response);
};
