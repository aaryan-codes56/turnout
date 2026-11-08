import { z } from "zod";

import type { ActionResult } from "@/lib/action-result";
import { AppError } from "@/server/errors";

/**
 * Turns expected failures into a message the form can show. Anything else is
 * rethrown, which also lets Next.js's redirect() pass through.
 */
export async function runAction(
  action: () => Promise<string | void>,
): Promise<ActionResult> {
  try {
    const message = await action();
    return { status: "success", message: message ?? undefined };
  } catch (error) {
    if (error instanceof AppError) {
      return { status: "error", message: error.message };
    }
    if (error instanceof z.ZodError) {
      return { status: "error", message: error.issues[0].message };
    }
    throw error;
  }
}
