import { runApi } from "@/server/run-api";
import { handleRazorpayWebhook } from "@/server/services/payments";

export async function POST(request: Request) {
  return runApi(async () => {
    // Read as text: the signature covers the exact bytes Razorpay sent, and
    // parsing then re-serialising JSON would change them.
    const rawBody = await request.text();
    const result = await handleRazorpayWebhook({
      rawBody,
      signature: request.headers.get("x-razorpay-signature"),
      eventId: request.headers.get("x-razorpay-event-id"),
    });
    return { result };
  });
}
