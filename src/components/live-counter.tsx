"use client";

import { useEffect, useState } from "react";

type Counts = { confirmed: number; checkedIn: number };

const POLL_MS = 5000;

export function useCheckinCounts(eventId: string, initial: Counts | null) {
  const [counts, setCounts] = useState(initial);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      if (document.hidden) return;
      const response = await fetch(`/api/events/${eventId}/checkin/counts`).catch(() => null);
      if (response?.ok && !cancelled) setCounts((await response.json()) as Counts);
    }
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [eventId]);

  return counts;
}

export function LiveCounter({ eventId, initial }: { eventId: string; initial: Counts }) {
  const counts = useCheckinCounts(eventId, initial) ?? initial;

  return (
    <p aria-live="polite" className="font-heading text-6xl font-black">
      {counts.checkedIn}
      <span className="text-3xl"> of {counts.confirmed} checked in</span>
    </p>
  );
}
