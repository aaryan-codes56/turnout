import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Link,
  Preview,
  Text,
} from "@react-email/components";
import type { ReactNode } from "react";

import { brand } from "@/lib/brand";

const INK = "#21125e";

function Layout({ preview, children }: { preview: string; children: ReactNode }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: "#fbf9ff", color: INK, fontFamily: "Arial, sans-serif" }}>
        <Container style={{ maxWidth: 480, padding: 24 }}>
          <Text style={{ fontSize: 22, fontWeight: 800, margin: "0 0 16px" }}>
            {brand.name}
          </Text>
          {children}
        </Container>
      </Body>
    </Html>
  );
}

type EventDetails = {
  title: string;
  when: string;
  venue: string;
  url: string;
};

function Details({ title, when, venue, url }: EventDetails) {
  return (
    <>
      <Heading as="h1" style={{ fontSize: 26, margin: "0 0 12px" }}>
        {title}
      </Heading>
      <Text style={{ fontSize: 16, margin: "0 0 4px" }}>{when}</Text>
      <Text style={{ fontSize: 16, margin: "0 0 16px" }}>{venue}</Text>
      <Link href={url} style={{ color: INK, textDecoration: "underline" }}>
        View event
      </Link>
    </>
  );
}

export function TicketEmail(props: EventDetails & { name: string }) {
  return (
    <Layout preview={`Your ticket for ${props.title}`}>
      <Text style={{ fontSize: 16 }}>
        Hi {props.name}, you&apos;re in. Show this QR code at the door.
      </Text>
      <Details {...props} />
      <Img
        src="cid:ticket-qr"
        alt={`QR ticket for ${props.title}`}
        width={280}
        height={280}
        style={{ marginTop: 20, backgroundColor: "#ffffff" }}
      />
      <Text style={{ fontSize: 14 }}>
        The calendar file attached adds this event to your phone.
      </Text>
    </Layout>
  );
}

export function ReminderEmail(props: EventDetails & { startsIn: string }) {
  return (
    <Layout preview={`${props.title} starts in ${props.startsIn}`}>
      <Text style={{ fontSize: 16 }}>
        Starting in {props.startsIn}. Your QR ticket is in Turnout under My
        tickets.
      </Text>
      <Details {...props} />
    </Layout>
  );
}

export function CancellationEmail(props: EventDetails & { refunded: boolean }) {
  return (
    <Layout preview={`${props.title} has been cancelled`}>
      <Text style={{ fontSize: 16 }}>
        This event has been cancelled.
        {props.refunded ? " Your payment will be refunded automatically." : ""}
      </Text>
      <Details {...props} />
    </Layout>
  );
}

export function RefundEmail(props: EventDetails & { reason: string; amount: string }) {
  return (
    <Layout preview={`Refund for ${props.title}`}>
      <Text style={{ fontSize: 16 }}>
        We&apos;ve refunded your {props.amount} payment. {props.reason}
      </Text>
      <Details {...props} />
    </Layout>
  );
}

export function SummaryEmail(
  props: EventDetails & {
    confirmed: number;
    checkedIn: number;
    noShowRate: string;
  },
) {
  return (
    <Layout preview={`How ${props.title} went`}>
      <Details {...props} />
      <Text style={{ fontSize: 16, marginTop: 20 }}>
        Registered: {props.confirmed}
        <br />
        Checked in: {props.checkedIn}
        <br />
        No-show rate: {props.noShowRate}
      </Text>
    </Layout>
  );
}
