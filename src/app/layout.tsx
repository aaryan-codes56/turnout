import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible, Big_Shoulders } from "next/font/google";

import { SiteHeader } from "@/components/site-header";
import { brand } from "@/lib/brand";

import "./globals.css";

// Poster type for headings; a typeface designed for legibility for everything
// someone has to read quickly at a door.
const display = Big_Shoulders({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["800", "900"],
});

const body = Atkinson_Hyperlegible({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: { default: brand.name, template: `%s | ${brand.name}` },
  description: brand.description,
};

export const viewport: Viewport = {
  themeColor: "#fbf9ff",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
