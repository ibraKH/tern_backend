export type ErrorCode =
  | "VALIDATION_ERROR"
  | "AUTH_INVALID_CREDENTIALS"
  | "AUTH_UNVERIFIED"
  | "AUTH_TOKEN_INVALID"
  | "AUTH_TOKEN_EXPIRED"
  | "AUTH_FORBIDDEN"
  | "RESOURCE_CONFLICT"
  | "NOT_FOUND"
  | "INTERNAL_ERROR"
  | "DB_ERROR";

export class AppError extends Error {
  status: number;
  code: ErrorCode;
  details?: unknown;
  constructor(status: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(details?: unknown) {
    super(400, "VALIDATION_ERROR", "validation failed", details);
  }
}
export class AuthInvalidError extends AppError {
  constructor() {
    super(401, "AUTH_INVALID_CREDENTIALS", "invalid credentials");
  }
}
export class ForbiddenError extends AppError {
  constructor(message = "forbidden", details?: unknown) {
    super(403, "AUTH_FORBIDDEN", message, details);
  }
}
export class ConflictError extends AppError {
  constructor(message = "resource conflict", details?: unknown) {
    super(409, "RESOURCE_CONFLICT", message, details);
  }
}
export class DbError extends AppError {
  constructor(details?: unknown) {
    super(500, "DB_ERROR", "database error", details);
  }
}

export class AuthUnverifiedError extends AppError {
  constructor() {
    super(403, "AUTH_UNVERIFIED", "email not verified");
  }
}

export class AuthTokenInvalidError extends AppError {
  constructor() {
    super(400, "AUTH_TOKEN_INVALID", "invalid verification token");
  }
}

export class AuthTokenExpiredError extends AppError {
  constructor() {
    super(400, "AUTH_TOKEN_EXPIRED", "verification token expired, please request a new one");
  }
}
