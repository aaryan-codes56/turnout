import { registerSchema } from "@/lib/validation";
import { requireActor } from "@/server/auth/session";
import { enforceRateLimit } from "@/server/rate-limit";
import { runApi } from "@/server/run-api";
import { register } from "@/server/services/registrations";

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/events/[eventId]/register">,
) {
  return runApi(async () => {
    const { eventId } = await params;
    const input = registerSchema.parse(await request.json());
    const actor = await requireActor();
    await enforceRateLimit(`register:${actor.id}`, 20, 60);
    return register(actor, eventId, input);
  });
}
