import { createHmac, timingSafeEqual } from "node:crypto";

function hmacHex(message: string, secret: string): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const first = Buffer.from(a);
  const second = Buffer.from(b);
  return first.length === second.length && timingSafeEqual(first, second);
}

/** Checks the signature Razorpay Checkout hands the browser after payment. */
export function verifyCheckoutSignature(
  params: { orderId: string; paymentId: string; signature: string },
  keySecret: string,
): boolean {
  return safeEqual(
    hmacHex(`${params.orderId}|${params.paymentId}`, keySecret),
    params.signature,
  );
}

/** Must be given the raw request body, before any JSON parsing. */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  webhookSecret: string,
): boolean {
  return safeEqual(hmacHex(rawBody, webhookSecret), signature);
}
