export class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function badRequest(message) {
  return new ApiError(400, message);
}

export function unauthorized(message) {
  return new ApiError(401, message);
}

export function forbidden(message) {
  return new ApiError(403, message);
}

export function notFound(message) {
  return new ApiError(404, message);
}

export function conflict(message) {
  return new ApiError(409, message);
}

export function paymentRequired(message) {
  return new ApiError(402, message);
}

export function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function parseZod(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw badRequest(issue?.message || "Invalid request");
  }
  return result.data;
}
