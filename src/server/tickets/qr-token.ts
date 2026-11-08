import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function sign(registrationId: string): string {
  return createHmac("sha256", env.QR_SIGNING_SECRET)
    .update(registrationId)
    .digest("base64url");
}

/** The QR holds only an id and its signature, never personal details. */
export function createQrPayload(registrationId: string): string {
  return `${registrationId}.${sign(registrationId)}`;
}

/** Returns the registration id, or null if the signature doesn't match. */
export function verifyQrPayload(payload: string): string | null {
  const [registrationId, signature, ...rest] = payload.split(".");
  if (rest.length > 0 || !registrationId || !signature) return null;
  if (!UUID.test(registrationId)) return null;

  const expected = Buffer.from(sign(registrationId));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length) return null;
  return timingSafeEqual(expected, actual) ? registrationId : null;
}
