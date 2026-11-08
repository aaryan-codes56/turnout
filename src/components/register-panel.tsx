"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { brand } from "@/lib/brand";
import type { CustomQuestion } from "@/lib/event-questions";
import { cn } from "@/lib/utils";

type CheckoutResponse = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

type RazorpayOptions = {
  key: string;
  order_id: string;
  amount: number;
  currency: "INR";
  name: string;
  description: string;
  handler: (response: CheckoutResponse) => void;
  modal: { ondismiss: () => void };
};

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => { open: () => void };
  }
}

function loadCheckoutScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load checkout"));
    document.body.append(script);
  });
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Something went wrong. Try again.");
  return data;
}

type RegisterResult =
  | { status: "CONFIRMED" }
  | { status: "PENDING_PAYMENT"; orderId: string; amountPaise: number; keyId: string };

type Props = {
  eventId: string;
  eventSlug: string;
  eventTitle: string;
  questions: CustomQuestion[];
  signedIn: boolean;
  needsRollNumber: boolean;
  isPaid: boolean;
  priceLabel: string;
  resumingPayment: boolean;
};

export function RegisterPanel({
  eventId,
  eventSlug,
  eventTitle,
  questions,
  signedIn,
  needsRollNumber,
  isPaid,
  priceLabel,
  resumingPayment,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!signedIn) {
    return (
      <Link
        href={`/sign-in?next=${encodeURIComponent(`/e/${eventSlug}`)}`}
        className={cn(buttonVariants(), "h-12 px-6 text-base")}
      >
        Sign in to register
      </Link>
    );
  }

  async function openCheckout(result: Extract<RegisterResult, { status: "PENDING_PAYMENT" }>) {
    await loadCheckoutScript();
    if (!window.Razorpay) throw new Error("Could not load checkout");

    new window.Razorpay({
      key: result.keyId,
      order_id: result.orderId,
      amount: result.amountPaise,
      currency: "INR",
      name: brand.name,
      description: eventTitle,
      handler: (response) => {
        postJson("/api/payments/verify", response)
          .catch(() => {
            // The webhook confirms it anyway; the ticket will appear shortly.
          })
          .finally(() => {
            setBusy(false);
            router.push("/tickets");
            router.refresh();
          });
      },
      modal: { ondismiss: () => setBusy(false) },
    }).open();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const answers: Record<string, string | boolean> = {};
    for (const question of questions) {
      const field = `q_${question.id}`;
      answers[question.id] =
        question.type === "checkbox"
          ? form.get(field) === "on"
          : String(form.get(field) ?? "");
    }
    const rollNumber = form.get("rollNumber");

    try {
      const result = await postJson<RegisterResult>(
        `/api/events/${eventId}/register`,
        { answers, ...(rollNumber ? { rollNumber: String(rollNumber) } : {}) },
      );
      if (result.status === "PENDING_PAYMENT") {
        await openCheckout(result);
        return;
      }
      router.push("/tickets");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid max-w-md gap-4">
      <fieldset disabled={busy} className="contents">
        {needsRollNumber && (
          <div className="grid gap-2">
            <Label htmlFor="rollNumber">Roll number</Label>
            <Input id="rollNumber" name="rollNumber" required className="h-11" />
            <p className="text-sm text-muted-foreground">
              Asked once, so volunteers can find you at the door.
            </p>
          </div>
        )}
        {!resumingPayment &&
          questions.map((question) => (
            <QuestionField key={question.id} question={question} />
          ))}
        <Button type="submit" className="h-12 text-base">
          {resumingPayment
            ? "Finish payment"
            : isPaid
              ? `Pay ${priceLabel} and register`
              : "Register"}
        </Button>
      </fieldset>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}

function QuestionField({ question }: { question: CustomQuestion }) {
  const name = `q_${question.id}`;

  if (question.type === "checkbox") {
    return (
      <label className="flex min-h-11 items-center gap-3">
        <input
          type="checkbox"
          name={name}
          required={question.required}
          className="size-5 accent-[var(--primary)]"
        />
        <span>{question.label}</span>
      </label>
    );
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor={name}>
        {question.label}
        {question.required ? "" : " (optional)"}
      </Label>
      {question.type === "single_select" ? (
        <NativeSelect id={name} name={name} required={question.required} defaultValue="">
          <option value="" disabled={question.required}>
            Choose one
          </option>
          {question.options?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </NativeSelect>
      ) : (
        <Input
          id={name}
          name={name}
          required={question.required}
          maxLength={500}
          className="h-11"
        />
      )}
    </div>
  );
}
