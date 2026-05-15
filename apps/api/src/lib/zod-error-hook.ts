import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError, type ZodIssue } from "zod";

function formatIssues(issues: ZodIssue[]): string {
  return issues
    .map((i) => {
      const path = i.path.length ? i.path.join(".") + ": " : "";
      return `${path}${i.message}`;
    })
    .join("; ");
}

export function zodErrorHook(
  result: { success: true } | { success: false; error: ZodError },
  _c: Context
) {
  if (!result.success) {
    throw new HTTPException(400, {
      message: formatIssues(result.error.issues)
    });
  }
}
