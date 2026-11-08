# Architecture

Turnout is one Next.js app and one background worker, sharing the code in `src/server` and one Postgres database.

## System

```mermaid
flowchart LR
  phone["Student or volunteer's phone"] --> web["Next.js on Vercel<br/>pages, server actions, API routes"]
  google["Google OAuth"] <--> web
  web --> db[("Postgres on Neon<br/>app tables + pg-boss queue")]
  worker["Worker on Railway<br/>pg-boss handlers and cron"] --> db
  worker --> gmail["Gmail SMTP"]
  worker <--> razorpay["Razorpay"]
  web <--> razorpay
  razorpay -- "signed webhooks" --> web
```

Inside `src/server`, requests move in one direction:

```mermaid
flowchart LR
  route["Route handler or server action<br/>parse with Zod, find the actor"] --> service["services/*<br/>assertCan first, then business rules"]
  service --> perms["auth/permissions.ts"]
  service --> db[("Drizzle")]
  service --> queue["jobs/queue.ts<br/>enqueue inside the transaction"]
```

## Paid registration

Three things can confirm a payment: the browser, the webhook and the reconciliation job. All of them go through `confirmPayment`, which locks the payment row, so only the first one finds `PENDING_PAYMENT`.

```mermaid
sequenceDiagram
  participant B as Browser
  participant A as App
  participant D as Postgres
  participant R as Razorpay
  B->>A: POST /api/events/:id/register
  A->>D: Reserve seat, create PENDING_PAYMENT, 10 minute hold
  A->>R: Create order (outside the transaction)
  A-->>B: order id, amount from the database, key id
  B->>R: Checkout
  par Browser callback
    B->>A: POST /api/payments/verify
    A->>D: confirmPayment
  and Webhook
    R->>A: POST /api/webhooks/razorpay
    A->>D: Dedupe on event id, then confirmPayment
  and Hold expired, webhook late
    A->>R: Reconcile job asks for the order's payments
    A->>D: confirmPayment
  end
  D-->>A: Exactly one caller confirms and queues one ticket email
```

## Registration states

```mermaid
stateDiagram-v2
  [*] --> CONFIRMED: Free event
  [*] --> PENDING_PAYMENT: Paid event, seat held
  PENDING_PAYMENT --> CONFIRMED: Payment captured
  PENDING_PAYMENT --> EXPIRED: Hold ended, Razorpay says unpaid
  PENDING_PAYMENT --> CANCELLED: Order could not be created
  EXPIRED --> CONFIRMED: Late payment, seat still free
  EXPIRED --> REFUNDED: Late payment, event full
  CONFIRMED --> CANCELLED: Student cancels free ticket
  CONFIRMED --> REFUNDED: Admin refund or event cancelled
```

## Check-in

```mermaid
sequenceDiagram
  participant S as Scanner phone
  participant A as App
  participant D as Postgres
  S->>A: POST /api/events/:id/checkin with the QR payload
  A->>A: Permission, HMAC signature, check-in window
  A->>D: UPDATE ... WHERE checked_in_at IS NULL AND status = 'CONFIRMED'
  alt One row changed
    A-->>S: OK, with name and notes
  else No rows changed
    A->>D: Look up the reason
    A-->>S: ALREADY_CHECKED_IN, WRONG_EVENT, NOT_CONFIRMED or INVALID
  end
```

## Background jobs

| Job | When | Why it's safe to repeat |
|---|---|---|
| `send-ticket-email` | Registration confirmed | Job id from the registration; `sent_emails` row per ticket |
| `send-cancellation-notice` | Event cancelled | Same |
| `event-reminder` | 24h and 2h before start | Key includes the start time; old jobs see they're stale |
| `expire-holds-and-reconcile` | Every minute | Conditional updates |
| `refund-registration` | Admin refund, cancellation, late payment | Checks Razorpay for an existing refund first |
| `post-event-summary` | 2h after end | Key includes the end time; `sent_emails` row per recipient |
| `metrics-snapshot` | Nightly | Upsert on the date |
| `complete-ended-events` | Every 5 minutes | Conditional update |
