import { verifyPaymentSchema } from "@/lib/validation";
import { requireActor } from "@/server/auth/session";
import { enforceRateLimit } from "@/server/rate-limit";
import { runApi } from "@/server/run-api";
import { verifyClientPayment } from "@/server/services/payments";

export async function POST(request: Request) {
  return runApi(async () => {
    const input = verifyPaymentSchema.parse(await request.json());
    const actor = await requireActor();
    await enforceRateLimit(`verify:${actor.id}`, 30, 60);
    await verifyClientPayment(actor, {
      orderId: input.razorpay_order_id,
      paymentId: input.razorpay_payment_id,
      signature: input.razorpay_signature,
    });
    return { ok: true };
  });
}
