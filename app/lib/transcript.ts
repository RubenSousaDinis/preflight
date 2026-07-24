import type { HarnessEvent } from "@/src/shared";
import { FIXTURE_HARNESS_EVENTS } from "@/src/shared/fixtures";

/*
  TODO-INTEGRATE: E2 owns runTask (01-INTERFACES section 12), which returns an
  async iterable of these events. Until it lands the panel renders the frozen
  fixture stream, in the same array shape the live stream will append into.

  The panel renders the stream, never a narration written alongside it. A story
  that happens to match the events is indistinguishable from a fake at 3am and
  impossible to defend under questioning.
*/
export async function loadTranscript(): Promise<HarnessEvent[]> {
  return FIXTURE_HARNESS_EVENTS;
}

/**
 * Hedera settles in tinybars, one hundred millionth of an HBAR (02-DECISIONS
 * section 3). Amounts move through the event stream as decimal strings in that
 * smallest unit, so they are converted with BigInt rather than parsed as floats.
 */
export function formatHbar(raw: string): string {
  let value: bigint;
  try {
    value = BigInt(raw);
  } catch {
    return `${raw} (smallest unit)`;
  }
  const whole = value / 100_000_000n;
  const fraction = (value % 100_000_000n)
    .toString()
    .padStart(8, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction} HBAR` : `${whole} HBAR`;
}
