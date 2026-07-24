import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Preflight",
    template: "%s · Preflight",
  },
  description:
    "Checks an agent and a pending transaction at the boundary, and refuses when the evidence does not hold.",
};

/*
  Fonts load through a plain Google Fonts <link>, never next/font.
  next/font emits hashed family names, and the deck stage component resolves fonts
  by family name at runtime, so a hashed name degrades the deck to a fallback face
  with no error anywhere. See 02-DECISIONS section 9.
*/
const GOOGLE_FONTS_HREF =
  "https://fonts.googleapis.com/css2" +
  "?family=IBM+Plex+Mono:wght@400;500" +
  "&family=IBM+Plex+Sans:wght@400;500;600" +
  "&family=Source+Serif+4:opsz,wght@8..60,400..700" +
  "&display=swap";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        <link rel="stylesheet" href={GOOGLE_FONTS_HREF} />
      </head>
      <body className="flex min-h-svh flex-col">{children}</body>
    </html>
  );
}
