/** An expected failure, with a message that's safe to show the user. */
export class AppError extends Error {
  readonly status: number = 400;
}

export class UnauthenticatedError extends AppError {
  override readonly status = 401;
  constructor() {
    super("Sign in to do that.");
  }
}

export class ForbiddenError extends AppError {
  override readonly status = 403;
  constructor() {
    super("You don't have permission to do that.");
  }
}

export class NotFoundError extends AppError {
  override readonly status = 404;
}

export class ConflictError extends AppError {
  override readonly status = 409;
}

export class ValidationError extends AppError {
  override readonly status = 422;
}

export class RateLimitError extends AppError {
  override readonly status = 429;
  constructor() {
    super("Too many attempts. Wait a moment and try again.");
  }
}
