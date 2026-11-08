import { manualCheckinSchema, scanSchema } from "@/lib/validation";
import { requireActor } from "@/server/auth/session";
import { enforceRateLimit } from "@/server/rate-limit";
import { runApi } from "@/server/run-api";
import { checkInManually, checkInWithQr } from "@/server/services/checkin";

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/events/[eventId]/checkin">,
) {
  return runApi(async () => {
    const { eventId } = await params;
    const body: unknown = await request.json();
    const actor = await requireActor();
    // Generous on purpose: one volunteer at a busy door scans quickly.
    await enforceRateLimit(`checkin:${actor.id}`, 600, 60);

    const manual = manualCheckinSchema.safeParse(body);
    if (manual.success) {
      return checkInManually(actor, eventId, manual.data.registrationId);
    }
    return checkInWithQr(actor, eventId, scanSchema.parse(body).payload);
  });
}
