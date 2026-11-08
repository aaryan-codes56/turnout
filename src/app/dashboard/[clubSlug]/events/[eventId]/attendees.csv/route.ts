import { AppError } from "@/server/errors";
import { requireActor } from "@/server/auth/session";
import { exportAttendeesCsv } from "@/server/services/attendees";

export async function GET(
  _request: Request,
  { params }: RouteContext<"/dashboard/[clubSlug]/events/[eventId]/attendees.csv">,
) {
  try {
    const { eventId } = await params;
    const { filename, csv } = await exportAttendeesCsv(await requireActor(), eventId);
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return new Response(error.message, { status: error.status });
    }
    throw error;
  }
}
