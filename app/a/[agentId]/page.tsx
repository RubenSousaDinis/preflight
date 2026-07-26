import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Container } from "../../components/container";
import { agentLabelFor } from "../../lib/agent-display";
import {
  ENS_MIRROR_CHAIN_LABEL,
  ensResolverReadUrl,
} from "../../lib/ens-mirror-url";
import { loadAgentGradePage } from "../../lib/agent-grade-page";
import { gradeColor } from "../../lib/tokens";

/*
  Public landing for one agent: grade and evidence from the ValidationRegistry.
  ENS `url` text records point here. The registry remains the source; this page
  is a readable surface over it, not a second authority.
*/

export const dynamic = "force-dynamic";

export default async function AgentGradePage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId: raw } = await params;
  const agentId = raw.trim();
  if (!/^[0-9]+$/.test(agentId) || agentId.length > 78) notFound();

  const page = await loadAgentGradePage(agentId);
  const name = agentLabelFor(agentId);

  return (
    <main className="min-h-svh bg-paper text-ink">
      <Container className="py-10 pb-16">
        <p className="font-data text-[10.5px] tracking-[0.12em] text-meta">
          PREFLIGHT / AGENT GRADE
        </p>
        {/* The name reads first and the id follows it. The id is still the thing
            the registry is read by, so it stays on the page in the table below. */}
        <p className="mt-2 font-display text-[1.4rem] leading-tight font-semibold">
          {name ?? `Agent ${agentId}`}
          {name !== null ? (
            <span className="ml-2 font-data text-[0.8rem] font-normal text-meta">
              id {agentId}
            </span>
          ) : null}
        </p>
        <h1 className="mt-1 font-display text-[2.4rem] leading-tight font-semibold tracking-[-0.02em]">
          {page.kind === "graded" ? (
            <>
              Grade{" "}
              <span style={{ color: gradeColor(page.grade) }}>{page.grade}</span>
            </>
          ) : (
            "No published grade"
          )}
        </h1>
        <p className="mt-3 max-w-[36rem] text-[15px] leading-snug text-muted">
          {page.kind === "graded"
            ? "Read from the ValidationRegistry on Base Sepolia. ENS text records, when present, are a mirror of this record and never the source."
            : page.kind === "error"
              ? "The registry could not be read for this agent."
              : "This agent has no listable validation record from this validator yet."}
        </p>

        {page.kind === "error" ? (
          <p className="mt-6 border border-rule border-l-2 border-l-grade-c bg-band/50 px-4 py-3 text-[0.9rem] text-ink/80">
            {page.error.reason}
          </p>
        ) : null}

        {page.kind === "graded" ? (
          <>
            <dl className="mt-8 max-w-[40rem] divide-y divide-rule border border-rule">
              <Row label="agent id" value={agentId} mono breakAll />
              <Row label="score" value={`${page.score} / 100`} />
              <Row label="methodology" value={page.methodology} />
              <Row
                label="evidence hash"
                value={page.evidenceHash}
                mono
                breakAll
              />
              <Row
                label="evidence"
                value={
                  page.evidenceUri.length > 0 ? (
                    page.evidenceUri.startsWith("http") ||
                    page.evidenceUri.startsWith("ipfs://") ? (
                      <a
                        href={page.evidenceUri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="break-all text-accent underline-offset-2 hover:underline"
                      >
                        {page.evidenceUri}
                      </a>
                    ) : (
                      <span className="break-all font-data text-[0.8rem]">
                        {page.evidenceUri.slice(0, 200)}
                        {page.evidenceUri.length > 200 ? "…" : ""}
                      </span>
                    )
                  ) : (
                    <span className="text-meta">
                      URI not stored onchain (hash only)
                    </span>
                  )
                }
              />
              <Row
                label="expires (reader)"
                value={
                  page.expired
                    ? `expired ${new Date(page.expiresAt * 1000).toISOString()}`
                    : new Date(page.expiresAt * 1000).toISOString()
                }
              />
              {page.ens !== null ? (
                <Row
                  label="ENS"
                  value={
                    <>
                      <span className="break-all font-data text-[0.8rem]">
                        {page.ens.name}
                      </span>
                      {/* The name is text rather than a link because the place it
                          would link to, the ENS App, resolves through L1 and reads
                          null for every key here. The records answer on Base
                          Sepolia, so that is where the reader is sent. */}
                      <span className="mt-1 block font-data text-[0.7rem] leading-snug text-meta">
                        Records live on {ENS_MIRROR_CHAIN_LABEL} and answer there
                        only. Read them with{" "}
                        <span className="text-ink/70">text(node, key)</span> on the{" "}
                        <a
                          href={ensResolverReadUrl(page.ens.resolver)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent underline-offset-2 hover:underline"
                        >
                          resolver
                        </a>
                        .
                      </span>
                      <span className="mt-1 block font-data text-[0.7rem] break-all text-meta">
                        node {page.ens.node}
                      </span>
                    </>
                  }
                />
              ) : null}
              <Row label="validator" value={page.validator} mono breakAll />
            </dl>

            {page.partners.length > 0 ? (
              <section className="mt-8 max-w-[40rem]">
                <h2 className="font-data text-[0.64rem] uppercase tracking-[0.16em] text-meta">
                  partner stacks in this grade
                </h2>
                <ul className="mt-2 divide-y divide-rule border border-rule">
                  {page.partners.map((partner) => (
                    <li key={partner.partner} className="px-4 py-3">
                      <p className="font-data text-[0.85rem] text-ink">
                        <a
                          href={partner.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent underline-offset-2 hover:underline"
                        >
                          {partner.label}
                        </a>
                      </p>
                      <p className="mt-1 text-[0.82rem] leading-snug text-muted">
                        {partner.note}
                      </p>
                      <p className="mt-1 font-data text-[0.7rem] break-all text-meta">
                        {partner.href}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : null}

        <p className="mt-10 font-data text-[12px] text-meta">
          <Link href="/" className="text-accent underline-offset-2 hover:underline">
            Preflight
          </Link>
          {" · "}
          <Link
            href="/console?view=grade"
            className="text-accent underline-offset-2 hover:underline"
          >
            Grade an agent
          </Link>
        </p>
      </Container>
    </main>
  );
}

function Row({
  label,
  value,
  mono = false,
  breakAll = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  breakAll?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
      <dt className="font-data text-[0.68rem] uppercase tracking-[0.12em] text-meta">
        {label}
      </dt>
      <dd
        className={`text-[0.92rem] text-ink/85 ${mono ? "font-data text-[0.8rem]" : ""} ${breakAll ? "break-all" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}
