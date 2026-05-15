import { HTTPException } from "hono/http-exception";

export function notFound(resource: string, id: string): HTTPException {
  return new HTTPException(404, {
    message: `${resource} ${id} not found`
  });
}

export function conflict(message: string): HTTPException {
  return new HTTPException(409, { message });
}

export function badRequest(message: string): HTTPException {
  return new HTTPException(400, { message });
}
