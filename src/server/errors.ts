/** An expected failure, with a message that's safe to show the user. */
export class AppError extends Error {}

export class UnauthenticatedError extends AppError {
  constructor() {
    super("Sign in to do that.");
  }
}

export class ForbiddenError extends AppError {
  constructor() {
    super("You don't have permission to do that.");
  }
}

export class NotFoundError extends AppError {}
export class ConflictError extends AppError {}
export class ValidationError extends AppError {}
