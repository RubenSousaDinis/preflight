/**
 * Frozen type shapes, transcribed from tasks/01-INTERFACES.md.
 *
 * Every shape that crosses a task boundary lives here and nowhere else. A shape restated in six
 * places diverges by H+10. Section numbers below match that document.
 *
 * Fail closed: where a field can carry "we could not tell", its null is a refusal, never a pass.
 * No shape in this file has an `unknown` verdict a caller may read as permission.
 */

// ---------------------------------------------------------------------------
// 0. Shared primitives
// ---------------------------------------------------------------------------

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F'
export type Score = 100 | 75 | 50 | 25 | 0
export type Hex = `0x${string}`
/** Normalized with getAddress at every boundary. Never hand-checksummed. */
export type Address = Hex
export type ChainId = number
/** ERC-8004 identity id. */
export type AgentId = string
/** `eip155:{chainId}:{checksummedAddress}` */
export type ContractRef = string
/** txGuard, the contract boundary. */
export type Verdict = 'ALLOW' | 'BLOCK'
/** vetAgent, the agent boundary. */
export type GateVerdict = 'HIRE' | 'REFUSE'

/** Anything that survives canonical JSON. Floats are excluded by the canonical form itself. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

// ---------------------------------------------------------------------------
// 1. A2: agent resolution
// ---------------------------------------------------------------------------

export interface AgentCard {
  /** Echoed input. */
  agentId: AgentId
  /** Display name from the card. `''` when the card omits it, never null. */
  name: string
  /** MCP service URLs declared by the card. Empty is a hard error upstream, never an empty result. */
  mcpEndpoints: string[]
  /** Declared skill references. Empty is legitimate. */
  skillRefs: string[]
  /** The unmodified parsed card, retained before any field access. A3a hashes this. */
  raw: unknown
  /** Where the card was fetched from, as the registry reported it. Never rewritten to a gateway URL. */
  tokenURI: string
}

// ---------------------------------------------------------------------------
// 2. A3a: grading, canonicalization, hashing
// ---------------------------------------------------------------------------

/**
 * One page of an MCP `tools/list` enumeration, kept verbatim.
 *
 * The tools are held as parsed JSON rather than a narrowed shape on purpose: the fingerprint is a
 * hash over what the server actually returned, so narrowing here would silently drop the bytes that
 * a drift check depends on.
 */
export interface ToolSurfacePage {
  cursor: string | null
  tools: JsonValue[]
}

export interface ToolSurface {
  endpoint: string
  pages: ToolSurfacePage[]
  /** Flat count across every page. A single-page read passes a target that hid tools behind paging. */
  toolCount: number
}

/** One endpoint's litmus run, as composed into the bundle by A3a. */
export interface EndpointEvidence {
  endpoint: string
  grade: Grade
  /**
   * The evidence bundle the installed litmus package returned, verbatim.
   *
   * Deliberately still JsonValue now that the package is installed. This field is hashed as JSON, so
   * JSON is the type that describes it, and narrowing it to the engine's exported interface would pull
   * engine types into every consumer of this file, the UI included. A3a validates the fields it reads
   * before composing the bundle.
   */
  litmus: JsonValue
}

/**
 * The reproducible evidence behind one grade. Owned by A3a; additions are append-only.
 *
 * `schema` is first so a reader can tell which shape it is holding before trusting any other field.
 */
export interface EvidenceBundle {
  schema: 'preflight-evidence-v1'
  agentId: AgentId
  tokenURI: string
  /** The card exactly as A2 retained it. */
  card: JsonValue
  /** Read from the installed litmus package at runtime. Never typed by hand. */
  methodologyVersion: string
  /** Version of the installed engine, for the record. */
  engineVersion: string
  endpoints: EndpointEvidence[]
  toolSurface: ToolSurface[]
  /** Unix seconds. */
  ranAt: number
  /** Stated coverage, so a partial run is legible rather than implied. */
  coverage: {
    endpointsDeclared: number
    endpointsGraded: number
    note: string | null
  }
}

export interface GradeResult {
  grade: Grade
  /** Derived from `grade` by the 02-DECISIONS §5 table, never independently assigned. */
  score: Score
  bundle: EvidenceBundle
  /** keccak256 over the canonical bundle. */
  evidenceHash: Hex
  /** Read from the installed litmus package. */
  methodologyVersion: string
  /** Canonical hash of the graded tool surface. B1's drift baseline. */
  toolFingerprint: Hex
  /** Unix seconds. */
  ranAt: number
}

// ---------------------------------------------------------------------------
// 3. A3b: publish
// ---------------------------------------------------------------------------

export interface ValidationRecord {
  agentId: AgentId
  /** The onchain 0 to 100 response. */
  score: Score
  /** Where the evidence bundle is retrievable. */
  responseURI: string
  /** keccak256 of the canonical bundle. */
  responseHash: Hex
  /** The methodologyVersion. */
  tag: string
  /** A record from any other validator is ignored, not trusted. */
  validator: Address
  /** Non-zero unix seconds. An expired record is treated as absent. */
  expiresAt: number
  txHash: Hex
}

// ---------------------------------------------------------------------------
// 4. B1: vetAgent, the agent boundary
// ---------------------------------------------------------------------------

export interface GatePolicy {
  /** Default 'B'. */
  minGrade: Grade
  /** Staleness bound on the attestation, in seconds. */
  maxAgeSeconds: number
}

export interface GateDecision {
  /** 'REFUSE' on every error path. */
  verdict: GateVerdict
  /** Renderable and specific. This is what the demo shows. */
  reason: string
  grade: Grade | null
  score: Score | null
  /** null when the live check could not run, which is itself a refusal. */
  fingerprintMatch: boolean | null
  record: ValidationRecord | null
}

// ---------------------------------------------------------------------------
// 5. B2: receipts
// ---------------------------------------------------------------------------

export interface Receipt {
  /** Monotonic, human-quotable on stage. */
  id: string
  /** The decision, canonicalized. */
  subject: JsonValue
  /** keccak256 of the canonical verdict. */
  responseHash: Hex
  /** For agent decisions. null for tx verdicts. */
  evidenceURI: string | null
  /** From the installed package. */
  methodologyVersion: string
  /** For tx verdicts. null for agent decisions. */
  reproducibleFrom: SerializedTxTuple | null
  /** null only for the genesis receipt. */
  prevHash: Hex | null
  hash: Hex
  /** Ed25519 over `hash`. */
  sig: Hex
  signerPubKey: Hex
}

export interface ChainVerification {
  ok: boolean
  brokenAt: number | null
  reason: string | null
}

// ---------------------------------------------------------------------------
// 6. B4: contract identity and version
// ---------------------------------------------------------------------------

export type ProxyKind = 'none' | 'eip1967' | 'beacon' | 'uups' | 'eip1167' | 'diamond' | 'unknown'

export interface CodeFingerprint {
  /** Canonical hash over the composed code hashes. Never a partial hash. */
  fingerprint: Hex
  /** 'unknown' forces the caller to fail closed. */
  proxyKind: ProxyKind
  /** Implementations and facets, in slot order. Empty is a hard error upstream. */
  resolved: { address: Address; codeHash: Hex }[]
  /** The drift anchor. Never defaulted to head. */
  observedBlock: bigint
}

// ---------------------------------------------------------------------------
// 7. B5a: simulation harness
// ---------------------------------------------------------------------------

export interface PendingTx {
  /** Required. txGuard is chain-parameterized, per 02-DECISIONS §3. */
  chainId: ChainId
  from: Address
  to: Address
  /** Exact bytes, never a re-encoded approximation. */
  calldata: Hex
  /** wei */
  value: bigint
}

export interface BalanceDelta {
  token: Address | 'native'
  owner: Address
  delta: bigint
}

export interface ApprovalDelta {
  token: Address
  owner: Address
  spender: Address
  amount: bigint
}

export interface CallGraphEntry {
  from: Address
  to: Address
  selector: Hex
  value: bigint
}

export interface SimulationResult {
  /** Fork height. */
  block: bigint
  reverted: boolean
  /** `[]` only when there genuinely are none. */
  balanceDeltas: BalanceDelta[]
  /** `[]` only when there genuinely are none. */
  approvalDeltas: ApprovalDelta[]
  /** Resolved callees, for the bad-callee flag. */
  callGraph: CallGraphEntry[]
  /** The trace, kept for evidence. */
  raw: unknown
}

/**
 * The fork handle. `run` is stateful and sequential: leg two observes what leg one left behind,
 * which is what makes two-leg detection possible and is also the trap. Each detector receives its
 * own fork and releases it.
 */
export interface Fork {
  run(tx: PendingTx): Promise<SimulationResult>
  storageAt(address: Address, slot: Hex): Promise<Hex>
  release(): Promise<void>
}

/** The five values that make a verdict reproducible. */
export interface TxTuple {
  block: bigint
  from: Address
  to: Address
  calldataHash: Hex
  value: bigint
}

/** TxTuple with its bigints as decimal strings, for receipts, JSON, and the wire. */
export interface SerializedTxTuple {
  block: string
  from: Address
  to: Address
  calldataHash: Hex
  value: string
}

// ---------------------------------------------------------------------------
// 8. B5b to B5e: red-flag detectors
// ---------------------------------------------------------------------------

/** Closed set, per 02-DECISIONS §6. Do not widen. */
export type FlagId = 'drainer-approval' | 'honeypot' | 'bad-callee' | 'owner-backdoor'

export interface Flag {
  id: FlagId
  /** Only 'block' moves a verdict. Advisory never blocks alone. */
  severity: 'block' | 'advisory'
  title: string
  detail: string
  /** 'llm-scan' alone can never yield severity 'block'. Checked when composing the verdict. */
  confirmedBy: 'simulation' | 'static' | 'llm-scan'
}

export type Detector = (
  sim: SimulationResult,
  tx: PendingTx,
  code: CodeFingerprint,
) => Promise<Flag[]>

// ---------------------------------------------------------------------------
// 9. B5 composition: txGuard
// ---------------------------------------------------------------------------

/** Owned by Lane 2's §9 composition. Additions land by arbitration. */
export interface TxPolicy {
  /** Pin the fork height. Omitted means the live block, recorded either way. */
  atBlock?: bigint
}

export interface TxVerdict {
  /** 'BLOCK' on every error path. */
  verdict: Verdict
  /** `[]` with verdict 'BLOCK' is legitimate when the failure is structural. */
  flags: Flag[]
  reason: string
  deltas: BalanceDelta[]
  reproducibleFrom: TxTuple
  /** Fingerprint at simulation time. */
  codeFingerprint: Hex
  /** Versus a stored version grade, when one exists. null when no prior grade. */
  driftFromGraded: boolean | null
}

// ---------------------------------------------------------------------------
// 10. B7: MCP surface
// ---------------------------------------------------------------------------

export interface PreflightAgentInput {
  ref: string
  minGrade?: Grade
}

/** MCP inputs arrive as JSON, so `value` is a decimal string and is parsed at the boundary. */
export interface PreflightTxInput {
  chainId: ChainId
  from: Address
  to: Address
  calldata: Hex
  value: string
}

// ---------------------------------------------------------------------------
// 11. B6, B8: advisory scan and divergence
// ---------------------------------------------------------------------------

export interface Divergence {
  matched: boolean
  simulated: BalanceDelta[]
  landed: BalanceDelta[]
  notes: string
}

// ---------------------------------------------------------------------------
// 12. E1, E2: fixtures and harness
// ---------------------------------------------------------------------------

/** E1's controllable surface. 'poisoned' returns hostile tool output for beat 1. */
export type ToolSurfaceVariant = 'baseline' | 'drifted' | 'poisoned'

export interface TaskSpec {
  budget: bigint
  task: string
  candidates: AgentId[]
}

/**
 * The harness event stream. The UI renders this directly, which is why it is part of the frozen
 * contract rather than an implementation detail of E2. Every event carries the GateDecision or
 * Receipt that justifies it.
 */
export type HarnessEvent =
  | { type: 'shopping'; at: number; candidates: AgentId[]; task: string; budget: string }
  | { type: 'vetted'; at: number; agentId: AgentId; decision: GateDecision; receipt: Receipt }
  | { type: 'hired'; at: number; agentId: AgentId; decision: GateDecision }
  | {
      type: 'paid'
      at: number
      agentId: AgentId
      /** Decimal string in the rail's smallest unit. */
      amount: string
      /**
       * Which rail actually settled it.
       *
       * Widened from the single x402 literal by arbitration: the event was labelling every payment
       * `hedera-x402` while a run on the direct-transfer rail settled by a native transfer, and a field
       * that names the wrong rail on screen is worse than one that names a plainer one.
       */
      rail: 'hedera-x402' | 'hedera-transfer' | 'stub'
      /** Transaction id on the payment rail, for the receipt panel. */
      txRef: string
      receipt: Receipt
    }
  | { type: 'toolOutput'; at: number; agentId: AgentId; output: JsonValue }
  | { type: 'injectionCaught'; at: number; agentId: AgentId; detail: string; receipt: Receipt }
  /**
   * `remaining` is carried rather than left to the reader.
   *
   * E2's done-when 4 wants the arithmetic visible in the events instead of computed by the UI, and
   * §12's table names the remaining budget as what this event carries. Appended to the frozen variant
   * after the fact, by arbitration, alongside the spend it is derived from.
   */
  | {
      type: 'frozen'
      at: number
      reason: string
      spentSoFar: string
      remaining: string
      receipt: Receipt
    }
  | {
      type: 'done'
      at: number
      hired: AgentId[]
      refused: AgentId[]
      spent: string
      budget: string
      receiptCount: number
    }
