import { z } from "zod";

import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";

/** Runs a route handler and turns its outcome into a JSON response. */
export async function runApi(handler: () => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await handler());
  } catch (error) {
    if (error instanceof AppError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return Response.json({ error: error.issues[0].message }, { status: 400 });
    }
    logger.error({ err: error }, "Unhandled API error");
    return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
