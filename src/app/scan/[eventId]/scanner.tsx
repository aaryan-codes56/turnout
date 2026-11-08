"use client";

import { BrowserQRCodeReader, type IScannerControls } from "@zxing/browser";
import { useCallback, useEffect, useRef, useState } from "react";

import { useCheckinCounts } from "@/components/live-counter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/time";

type Attendee = {
  name: string;
  rollNumber: string | null;
  email: string;
  notes: { label: string; value: string }[];
};

type Result =
  | { code: "OK"; attendee: Attendee }
  | {
      code: "ALREADY_CHECKED_IN";
      attendee: Attendee;
      checkedInAt: string;
      checkedInBy: string | null;
    }
  | { code: "WRONG_EVENT" | "INVALID" | "NOT_CONFIRMED" | "OUTSIDE_WINDOW" }
  | { code: "ERROR"; message: string };

type SearchResult = {
  registrationId: string;
  name: string;
  email: string;
  rollNumber: string | null;
  checkedInAt: string | null;
};

const SAME_CODE_COOLDOWN_MS = 4000;
const RESULT_VISIBLE_MS = 2200;

const FAILURES = {
  WRONG_EVENT: ["Wrong event", "This ticket is for a different event."],
  INVALID: ["Invalid ticket", "This QR code isn't a Turnout ticket."],
  NOT_CONFIRMED: ["Not confirmed", "This ticket is unpaid, cancelled or refunded."],
  OUTSIDE_WINDOW: ["Check-in closed", "Check-in isn't open for this event right now."],
} as const;

function ResultScreen({ result, onDismiss }: { result: Result; onDismiss: () => void }) {
  const tone =
    result.code === "OK"
      ? "bg-green-700 text-white"
      : result.code === "ALREADY_CHECKED_IN"
        ? "bg-yellow-400 text-black"
        : "bg-red-700 text-white";

  return (
    <button
      type="button"
      onClick={onDismiss}
      aria-live="assertive"
      className={`fixed inset-0 z-50 flex w-full flex-col justify-center p-6 text-left ${tone}`}
    >
      {result.code === "OK" || result.code === "ALREADY_CHECKED_IN" ? (
        <>
          <span className="font-heading text-6xl leading-none font-black">
            {result.code === "OK" ? "Checked in" : "Already in"}
          </span>
          <span className="mt-6 text-4xl font-bold wrap-anywhere">{result.attendee.name}</span>
          <span className="mt-2 text-2xl wrap-anywhere">
            {result.attendee.rollNumber ?? result.attendee.email}
          </span>
          {result.code === "ALREADY_CHECKED_IN" && (
            <span className="mt-6 text-2xl">
              {formatDateTime(new Date(result.checkedInAt))}
              {result.checkedInBy ? ` by ${result.checkedInBy}` : ""}
            </span>
          )}
          {result.attendee.notes.map((note) => (
            <span key={note.label} className="mt-3 text-xl wrap-anywhere">
              {note.label}: {note.value}
            </span>
          ))}
        </>
      ) : result.code === "ERROR" ? (
        <>
          <span className="font-heading text-6xl leading-none font-black">Try again</span>
          <span className="mt-6 text-2xl">{result.message}</span>
        </>
      ) : (
        <>
          <span className="font-heading text-6xl leading-none font-black">
            {FAILURES[result.code][0]}
          </span>
          <span className="mt-6 text-2xl">{FAILURES[result.code][1]}</span>
        </>
      )}
    </button>
  );
}

export function Scanner({
  eventId,
  title,
  isOpen,
}: {
  eventId: string;
  title: string;
  isOpen: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const busyRef = useRef(false);
  const lastScanRef = useRef({ payload: "", at: 0 });
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [result, setResult] = useState<Result | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<SearchResult[]>([]);
  const counts = useCheckinCounts(eventId, null);

  const showResult = useCallback((next: Result) => {
    setResult(next);
    if (next.code === "OK") navigator.vibrate?.(120);
    else if (next.code === "ALREADY_CHECKED_IN") navigator.vibrate?.([80, 60, 80]);
    else navigator.vibrate?.([250, 80, 250]);

    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setResult(null), RESULT_VISIBLE_MS);
  }, []);

  const submit = useCallback(
    async (body: { payload: string } | { registrationId: string }) => {
      try {
        const response = await fetch(`/api/events/${eventId}/checkin`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await response.json()) as Result & { error?: string };
        showResult(
          response.ok
            ? data
            : { code: "ERROR", message: data.error ?? "Something went wrong." },
        );
      } catch {
        showResult({ code: "ERROR", message: "No connection. Check your signal." });
      }
    },
    [eventId, showResult],
  );

  const handleDecoded = useCallback(
    async (payload: string) => {
      const now = Date.now();
      const last = lastScanRef.current;
      // The camera sees the same code many times a second. Ignore repeats.
      if (busyRef.current) return;
      if (payload === last.payload && now - last.at < SAME_CODE_COOLDOWN_MS) return;

      busyRef.current = true;
      lastScanRef.current = { payload, at: now };
      await submit({ payload });
      busyRef.current = false;
    },
    [submit],
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let controls: IScannerControls | undefined;
    let stopped = false;
    const reader = new BrowserQRCodeReader(undefined, {
      delayBetweenScanAttempts: 120,
    });

    reader
      .decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } } },
        video,
        (decoded) => {
          if (decoded) void handleDecoded(decoded.getText());
        },
      )
      .then((started) => {
        if (stopped) started.stop();
        else controls = started;
      })
      .catch(() => {
        setCameraError("Camera unavailable. Allow camera access, or search by name below.");
      });

    return () => {
      stopped = true;
      controls?.stop();
    };
  }, [handleDecoded]);

  useEffect(() => {
    if (query.trim().length < 2) {
      return;
    }
    const timer = setTimeout(async () => {
      const response = await fetch(
        `/api/events/${eventId}/checkin/search?q=${encodeURIComponent(query.trim())}`,
      ).catch(() => null);
      if (response?.ok) setMatches((await response.json()) as SearchResult[]);
    }, 250);
    return () => clearTimeout(timer);
  }, [eventId, query]);

  async function checkInManually(registrationId: string) {
    await submit({ registrationId });
    setQuery("");
    setMatches([]);
  }

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-4 pt-2 pb-10">
      {result && (
        <ResultScreen
          result={result}
          onDismiss={() => {
            clearTimeout(hideTimerRef.current);
            setResult(null);
          }}
        />
      )}

      <h1 className="font-heading text-4xl leading-none font-black">{title}</h1>
      <p className="mt-1 text-lg font-bold" aria-live="polite">
        {counts ? `${counts.checkedIn} of ${counts.confirmed} checked in` : " "}
      </p>
      {!isOpen && (
        <p role="status" className="mt-2 text-lg font-bold">
          Check-in isn&apos;t open for this event right now.
        </p>
      )}

      <div className="mt-3 aspect-square w-full overflow-hidden rounded-xl bg-black">
        <video ref={videoRef} muted playsInline className="size-full object-cover" />
      </div>
      {cameraError && (
        <p role="alert" className="mt-2 text-destructive">
          {cameraError}
        </p>
      )}

      <section className="mt-6">
        <h2 className="font-heading text-3xl font-black">Find someone</h2>
        <Input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            if (event.target.value.trim().length < 2) setMatches([]);
          }}
          placeholder="Name, email or roll number"
          aria-label="Find an attendee"
          className="mt-2 h-12"
        />
        <ul className="mt-2 divide-y">
          {matches.map((match) => (
            <li key={match.registrationId} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="font-bold wrap-anywhere">{match.name}</p>
                <p className="text-muted-foreground wrap-anywhere">
                  {match.rollNumber ?? match.email}
                </p>
              </div>
              <Button
                type="button"
                variant={match.checkedInAt ? "outline" : "default"}
                className="h-11 shrink-0 px-4"
                onClick={() => void checkInManually(match.registrationId)}
              >
                {match.checkedInAt ? "Already in" : "Check in"}
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
