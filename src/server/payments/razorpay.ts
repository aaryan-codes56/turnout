import Razorpay from "razorpay";

import { env } from "@/lib/env";
import { ValidationError } from "@/server/errors";

let client: Razorpay | undefined;

function getClient(): Razorpay {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    throw new ValidationError("Paid registration isn't set up yet.");
  }
  client ??= new Razorpay({
    key_id: env.RAZORPAY_KEY_ID,
    key_secret: env.RAZORPAY_KEY_SECRET,
  });
  return client;
}

export function paymentsConfigured(): boolean {
  return Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
}

/** Key prefixes say which mode they're for, so going live only takes new keys. */
export function currentPaymentMode(): "TEST" | "LIVE" {
  return env.RAZORPAY_KEY_ID?.startsWith("rzp_live_") ? "LIVE" : "TEST";
}

export async function createOrder(params: {
  amountPaise: number;
  registrationId: string;
}): Promise<{ id: string }> {
  const order = await getClient().orders.create({
    amount: params.amountPaise,
    currency: "INR",
    receipt: params.registrationId,
    notes: { registrationId: params.registrationId },
  });
  return { id: order.id };
}

export type GatewayPayment = { id: string; status: string };

export async function fetchOrderPayments(
  orderId: string,
): Promise<GatewayPayment[]> {
  const { items } = await getClient().orders.fetchPayments(orderId);
  return items.map((payment) => ({ id: payment.id, status: payment.status }));
}

export type GatewayRefund = { id: string; status: string };

export async function fetchRefunds(
  paymentId: string,
): Promise<GatewayRefund[]> {
  const { items } = await getClient().payments.fetchMultipleRefund(paymentId);
  return items.map((refund) => ({ id: refund.id, status: refund.status }));
}

export async function refundPayment(
  paymentId: string,
  amountPaise: number,
): Promise<GatewayRefund> {
  const refund = await getClient().payments.refund(paymentId, {
    amount: amountPaise,
  });
  return { id: refund.id, status: refund.status };
}
