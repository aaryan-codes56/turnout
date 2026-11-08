import { attendeeSearchSchema } from "@/lib/validation";
import { requireActor } from "@/server/auth/session";
import { runApi } from "@/server/run-api";
import { searchForCheckin } from "@/server/services/checkin";

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/events/[eventId]/checkin/search">,
) {
  return runApi(async () => {
    const { eventId } = await params;
    const query = attendeeSearchSchema.parse(
      new URL(request.url).searchParams.get("q"),
    );
    return searchForCheckin(await requireActor(), eventId, query);
  });
}
