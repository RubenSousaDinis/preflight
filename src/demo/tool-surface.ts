/**
 * The three tool surfaces the demo server can present.
 *
 * Each variant moves exactly one axis. `baseline` is the surface that gets graded. `drifted` changes
 * the tool set and nothing else. `poisoned` changes tool output and nothing else, so its list is
 * identical to baseline byte for byte. A variant that moved two axes at once would make every
 * downstream refusal ambiguous: a gate refusing on drift never reaches the injection, and beat 1
 * would show the wrong mechanism.
 *
 * The list spans more than one page on purpose. A single-page surface lets a paging bug ship
 * undetected, and a server that parks a tool behind a cursor is exactly the target the live recheck
 * exists to catch.
 */

import type { JsonValue, ToolSurfaceVariant } from '../shared/types.ts'

export interface DemoTool {
  name: string
  description: string
  inputSchema: JsonValue
}

/** Small enough that the baseline surface needs three pages. */
export const PAGE_SIZE = 10

function textIn(property: string, description: string): JsonValue {
  return {
    type: 'object',
    properties: { [property]: { type: 'string', description } },
    required: [property],
  }
}

/** A plausible research agent's surface. Twenty one tools, so three pages at ten per page. */
export const BASELINE_TOOLS: DemoTool[] = [
  { name: 'search_sources', description: 'Search the corpus for sources matching a query.', inputSchema: textIn('query', 'What to search for') },
  { name: 'fetch_page', description: 'Fetch one source document by id.', inputSchema: textIn('id', 'Source id') },
  { name: 'extract_text', description: 'Extract the readable text of a fetched document.', inputSchema: textIn('id', 'Source id') },
  { name: 'summarize_sources', description: 'Summarize the fetched sources into one paragraph.', inputSchema: textIn('ids', 'Comma separated source ids') },
  { name: 'cite_sources', description: 'Return citations for the sources used in a summary.', inputSchema: textIn('ids', 'Comma separated source ids') },
  { name: 'compare_claims', description: 'Compare the claims two sources make about the same subject.', inputSchema: textIn('ids', 'Two source ids') },
  { name: 'rank_relevance', description: 'Rank sources by how well they answer a question.', inputSchema: textIn('question', 'The question to rank against') },
  { name: 'detect_language', description: 'Report the language of a document.', inputSchema: textIn('id', 'Source id') },
  { name: 'translate_text', description: 'Translate a passage into English.', inputSchema: textIn('text', 'The passage to translate') },
  { name: 'outline_document', description: 'Produce a section outline for a document.', inputSchema: textIn('id', 'Source id') },
  { name: 'expand_outline', description: 'Expand one outline section into prose.', inputSchema: textIn('section', 'The section heading') },
  { name: 'find_quotes', description: 'Find quotable passages supporting a claim.', inputSchema: textIn('claim', 'The claim to support') },
  { name: 'verify_quote', description: 'Check that a quote appears in the cited source.', inputSchema: textIn('quote', 'The quote to verify') },
  { name: 'list_authors', description: 'List the authors of a source.', inputSchema: textIn('id', 'Source id') },
  { name: 'resolve_doi', description: 'Resolve a DOI to its metadata record.', inputSchema: textIn('doi', 'The DOI to resolve') },
  { name: 'fetch_abstract', description: 'Fetch the abstract of a paper.', inputSchema: textIn('doi', 'The DOI to fetch') },
  { name: 'cluster_topics', description: 'Cluster the fetched sources by topic.', inputSchema: textIn('ids', 'Comma separated source ids') },
  { name: 'tag_entities', description: 'Tag named entities in a passage.', inputSchema: textIn('text', 'The passage to tag') },
  { name: 'score_readability', description: 'Score how readable a passage is.', inputSchema: textIn('text', 'The passage to score') },
  { name: 'export_markdown', description: 'Export the working notes as markdown.', inputSchema: textIn('title', 'Document title') },
  { name: 'export_json', description: 'Export the working notes as JSON.', inputSchema: textIn('title', 'Document title') },
]

/**
 * What `drifted` adds. Adding rather than removing, per E1's open question: the count grows visibly
 * and a removed tool reads as an outage instead of a change. These three are the ones worth saying
 * out loud, because a surface that grew a funds-moving tool after it was graded is the whole point.
 */
export const DRIFT_ADDED_TOOLS: DemoTool[] = [
  {
    name: 'transfer_funds',
    description: 'Transfer funds from the caller wallet to a recipient address.',
    inputSchema: {
      type: 'object',
      properties: {
        recipient: { type: 'string', description: 'Recipient address' },
        amount: { type: 'string', description: 'Amount, in the smallest unit' },
      },
      required: ['recipient', 'amount'],
    },
  },
  { name: 'read_env', description: 'Read an environment variable from the host process.', inputSchema: textIn('name', 'Variable name') },
  { name: 'post_webhook', description: 'Post the working notes to an external webhook.', inputSchema: textIn('url', 'Destination URL') },
]

export const DRIFTED_TOOLS: DemoTool[] = [...BASELINE_TOOLS, ...DRIFT_ADDED_TOOLS]

/** C2's headline reason quotes these two numbers, so they are read from here, never retyped. */
export const BASELINE_TOOL_COUNT = BASELINE_TOOLS.length
export const DRIFTED_TOOL_COUNT = DRIFTED_TOOLS.length

export function toolsFor(variant: ToolSurfaceVariant): DemoTool[] {
  // poisoned shares baseline's list exactly. Only its output differs.
  return variant === 'drifted' ? DRIFTED_TOOLS : BASELINE_TOOLS
}

export function toolByName(variant: ToolSurfaceVariant, name: string): DemoTool | undefined {
  return toolsFor(variant).find((tool) => tool.name === name)
}

export const VARIANTS: readonly ToolSurfaceVariant[] = ['baseline', 'drifted', 'poisoned']

export function isVariant(value: unknown): value is ToolSurfaceVariant {
  return typeof value === 'string' && (VARIANTS as readonly string[]).includes(value)
}
