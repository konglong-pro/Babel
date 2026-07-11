export class VaultError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends VaultError {
  constructor(message: string) {
    super(message, 400);
  }
}

export class ConflictError extends VaultError {
  constructor(message: string) {
    super(message, 409);
  }
}

export class NotFoundError extends VaultError {
  constructor(message: string) {
    super(message, 404);
  }
}
