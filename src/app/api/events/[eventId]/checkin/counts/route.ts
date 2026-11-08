import { requireActor } from "@/server/auth/session";
import { runApi } from "@/server/run-api";
import { getCheckinCounts } from "@/server/services/checkin";

export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/events/[eventId]/checkin/counts">,
) {
  return runApi(async () => {
    const { eventId } = await params;
    return getCheckinCounts(await requireActor(), eventId);
  });
}
