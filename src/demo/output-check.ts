/**
 * Checking a live tool result for an instruction aimed at the caller.
 *
 * This runs the engine's own C-01 scanners, the same ones that decide whether a server fails injection
 * at grading time. That is the answer to E2's open question: one mechanism, applied twice, rather than
 * a second check with its own opinions. A matcher written here and tuned to the demo payload would
 * prove nothing about the mechanism, and it is exactly what the task's traps table warns against.
 *
 * The bar is the engine's bar: a high-severity finding fails. Medium findings are reported and do not
 * stop the run on their own, which mirrors how C-01 grades a zero-width code point.
 */

import {
  hasHighSeverity,
  instructionMimicry,
  invisibleUnicode,
  markdownTricks,
  toolPoisoning,
  type Finding,
} from '@polygraphso/litmus'

export interface OutputCheck {
  hostile: boolean
  findings: Finding[]
  /** One line, renderable, naming what fired rather than restating the payload. */
  detail: string
}

export function checkToolOutput(text: string): OutputCheck {
  const findings = [
    ...instructionMimicry(text),
    ...toolPoisoning(text),
    ...invisibleUnicode(text),
    ...markdownTricks(text),
  ]
  const hostile = hasHighSeverity(findings)
  const high = findings.filter((finding) => finding.severity === 'high')
  const detail = hostile
    ? `the tool output carried an instruction aimed at the caller: ${high
        .map((finding) => `${finding.kind} (${JSON.stringify(finding.match ?? '')})`)
        .join(', ')}`
    : findings.length > 0
      ? `no instruction aimed at the caller; ${findings.length} lower-severity finding(s) recorded`
      : 'no instruction aimed at the caller'
  return { hostile, findings, detail }
}

/** Flattens an MCP tool result into the text the scanners read. */
export function textOfToolResult(result: unknown): string {
  if (typeof result === 'string') return result
  if (result === null || typeof result !== 'object') return ''
  const content = (result as { content?: unknown }).content
  if (!Array.isArray(content)) return JSON.stringify(result)
  return content
    .map((entry) => {
      if (typeof entry === 'string') return entry
      if (entry !== null && typeof entry === 'object') {
        const text = (entry as { text?: unknown }).text
        if (typeof text === 'string') return text
        return JSON.stringify(entry)
      }
      return ''
    })
    .join('\n')
}
