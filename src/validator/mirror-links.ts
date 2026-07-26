/**
 * Durable mainnet → Sepolia identity links for 8004scan mirror registrations.
 *
 * Uses node:fs. Keep this module off the client bundle (import only from server
 * code / dynamic imports inside server actions).
 *
 * Read order: in-memory overlay → MAINNET_SEPOLIA_LINKS env JSON →
 * data/mainnet-sepolia-links.json under process.cwd(). Writes update memory and
 * the JSON file when the filesystem allows (CLI / local).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type MirrorLink = {
  mainnetId: string;
  sepoliaId: string;
  /** Unix seconds when the Sepolia register landed (or was recorded). */
  linkedAt: number;
};

const ENV_KEY = "MAINNET_SEPOLIA_LINKS";

/**
 * Where the durable map lives, overridable.
 *
 * The override exists because `clearMirrorLinkMemory` writes an empty map, and the default path is
 * a file that is committed and that the gate depends on: without a way to point the tests
 * somewhere else, running the suite erased every published mirror link, and the next lookup
 * reported an agent as never graded. A test writing over checked-in data is the bug, not the
 * symptom, so the seam is here rather than a guard in the helper.
 */
const FILE_ENV_KEY = "PREFLIGHT_MIRROR_LINKS_FILE";

const memory = new Map<string, MirrorLink>();

function linksFilePath(): string {
  const override = process.env[FILE_ENV_KEY]?.trim();
  if (override !== undefined && override.length > 0) return override;
  return join(process.cwd(), "data/mainnet-sepolia-links.json");
}

function parseLinksJson(raw: string): MirrorLink[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return [];
  const out: MirrorLink[] = [];
  for (const row of parsed) {
    if (
      row !== null &&
      typeof row === "object" &&
      typeof (row as MirrorLink).mainnetId === "string" &&
      typeof (row as MirrorLink).sepoliaId === "string"
    ) {
      const link = row as MirrorLink;
      out.push({
        mainnetId: link.mainnetId,
        sepoliaId: link.sepoliaId,
        linkedAt:
          typeof link.linkedAt === "number"
            ? link.linkedAt
            : Math.floor(Date.now() / 1000),
      });
    }
  }
  return out;
}

function loadFileLinks(): MirrorLink[] {
  const path = linksFilePath();
  if (!existsSync(path)) return [];
  try {
    return parseLinksJson(readFileSync(path, "utf8"));
  } catch {
    return [];
  }
}

function loadEnvLinks(): MirrorLink[] {
  const raw = process.env[ENV_KEY]?.trim();
  if (raw === undefined || raw.length === 0) return [];
  try {
    return parseLinksJson(raw);
  } catch {
    return [];
  }
}

/** All known links, memory overlay winning. */
export function listMirrorLinks(): MirrorLink[] {
  const byMainnet = new Map<string, MirrorLink>();
  for (const link of loadFileLinks()) byMainnet.set(link.mainnetId, link);
  for (const link of loadEnvLinks()) byMainnet.set(link.mainnetId, link);
  for (const [id, link] of memory) byMainnet.set(id, link);
  return [...byMainnet.values()].sort(
    (a, b) => Number(a.mainnetId) - Number(b.mainnetId),
  );
}

export function sepoliaIdForMainnet(mainnetId: string): string | null {
  return (
    listMirrorLinks().find((link) => link.mainnetId === mainnetId)?.sepoliaId ??
    null
  );
}

export function mainnetIdForSepolia(sepoliaId: string): string | null {
  return (
    listMirrorLinks().find((link) => link.sepoliaId === sepoliaId)?.mainnetId ??
    null
  );
}

/**
 * Records a link. Always updates process memory; writes the JSON file when possible.
 */
export function recordMirrorLink(link: MirrorLink): void {
  memory.set(link.mainnetId, link);
  const merged = listMirrorLinks();
  const path = linksFilePath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  } catch {
    // Serverless / read-only FS: memory + returned sepoliaId still work for this process.
  }
}

/** Test helper: drop memory and reset the on-disk map to empty. */
export function clearMirrorLinkMemory(): void {
  memory.clear()
  try {
    writeFileSync(linksFilePath(), "[]\n", "utf8");
  } catch {
    // ignore
  }
}
