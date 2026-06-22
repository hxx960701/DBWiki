import { Request, Response, NextFunction } from 'express';

export class AppError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  console.error('[Error]', err);

  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  // Return the real error message so the frontend can show it to the user.
  // Non-AppErrors are typically database driver errors (network, auth, TLS)
  // that don't expose sensitive internals.
  res.status(500).json({ error: err.message || 'Internal server error' });
}
