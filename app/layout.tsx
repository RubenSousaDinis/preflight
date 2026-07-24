import type { Metadata } from "next";
import { SiteHeader } from "./components/site-header";
import { cssVariables, googleFontsHref } from "./lib/tokens";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Preflight",
    template: "%s · Preflight",
  },
  description:
    "Checks an agent and a pending transaction at the boundary, and refuses when the evidence does not hold.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/*
          Fonts load through a plain Google Fonts link, never next/font. next/font
          emits hashed family names and the deck stage component resolves fonts by
          family name at runtime, so a hashed name would degrade the deck to a
          fallback face with no error anywhere. See 02-DECISIONS section 9.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        <link rel="stylesheet" href={googleFontsHref} />
        {/* The token module is the only source of colour and family in the app. */}
        <style dangerouslySetInnerHTML={{ __html: cssVariables }} />
      </head>
      <body className="flex min-h-svh flex-col">
        <SiteHeader />
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
