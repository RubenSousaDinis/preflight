import { headers } from "next/headers";
import QRCode from "qrcode";

/**
 * The QR the room scans.
 *
 * Rendered to inline SVG on the server, so it needs no client script and fetches
 * nothing at the venue, and it scales to whatever the projector gives it without
 * going soft. The URL is built from the request host rather than configured, so it
 * is right on the preview, on the production domain, and on a laptop.
 */
export async function SubmitQr() {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  const url = `${protocol}://${host}/console#submit`;

  const svg = await QRCode.toString(url, {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
  });

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="w-full max-w-[15rem] [&>svg]:h-auto [&>svg]:w-full"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <p className="text-center font-data text-[0.74rem] break-all text-ink/60">
        {url}
      </p>
    </div>
  );
}
