import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";

/*
  The site shell: meta rule, sticky nav, dark call band, footer.

  The console sits outside this group on purpose. It carries its own chrome,
  because an operator running a beat wants the view and nothing above it, and the
  design sets it that way.
*/
export default function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
