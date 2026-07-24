/**
 * Typed failures, per the convention in tasks/01-INTERFACES.md.
 *
 * Errors are thrown, never swallowed into a partial result. A caller that cannot obtain a verdict
 * refuses. There is no `unknown` verdict a caller may treat as permission, so there is no "soft"
 * error type here either: every class below means the same thing to a gate, which is refuse.
 *
 * `retryable` records whether a retry could plausibly succeed. Nothing is retried automatically
 * inside a gate; the field exists so the UI can say why, not so a gate can loop.
 */

export type PreflightErrorCode =
  | 'CONFIG'
  | 'AGENT_RESOLVE'
  | 'GRADE'
  | 'PUBLISH'
  | 'VALIDATION_READ'
  | 'FINGERPRINT'
  | 'SIMULATION'
  | 'RECEIPT'
  | 'MCP'
  | 'HARNESS'

export interface PreflightErrorOptions {
  retryable?: boolean
  cause?: unknown
}

export class PreflightError extends Error {
  readonly code: PreflightErrorCode
  /** Human readable and renderable. This string reaches the screen. */
  readonly reason: string
  readonly retryable: boolean

  constructor(code: PreflightErrorCode, reason: string, options: PreflightErrorOptions = {}) {
    super(reason, { cause: options.cause })
    this.name = 'PreflightError'
    this.code = code
    this.reason = reason
    this.retryable = options.retryable ?? false
  }
}

/** A2: the id is unregistered, the tokenURI is unreachable, or the document does not parse. */
export class AgentResolveError extends PreflightError {
  constructor(reason: string, options: PreflightErrorOptions = {}) {
    super('AGENT_RESOLVE', reason, options)
    this.name = 'AgentResolveError'
  }
}

/** A3a: an endpoint was unreachable, litmus returned no bundle, or the round trip did not hold. */
export class GradeError extends PreflightError {
  constructor(reason: string, options: PreflightErrorOptions = {}) {
    super('GRADE', reason, options)
    this.name = 'GradeError'
  }
}

/** A3b: pinning or the attesting transaction failed. */
export class PublishError extends PreflightError {
  constructor(reason: string, options: PreflightErrorOptions = {}) {
    super('PUBLISH', reason, options)
    this.name = 'PublishError'
  }
}

/** A3b, B1: the registry read failed. Absence is not an error; it is `null`, and null means refuse. */
export class ValidationReadError extends PreflightError {
  constructor(reason: string, options: PreflightErrorOptions = {}) {
    super('VALIDATION_READ', reason, options)
    this.name = 'ValidationReadError'
  }
}

/** B1, B4: a tool surface or a contract's code could not be fingerprinted. Never a partial hash. */
export class FingerprintError extends PreflightError {
  constructor(reason: string, options: PreflightErrorOptions = {}) {
    super('FINGERPRINT', reason, options)
    this.name = 'FingerprintError'
  }
}

/** B5a: the fork could not be established or the trace could not be read. The gate blocks. */
export class SimulationError extends PreflightError {
  constructor(reason: string, options: PreflightErrorOptions = {}) {
    super('SIMULATION', reason, options)
    this.name = 'SimulationError'
  }
}

/** B2: a receipt could not be signed, or a chain could not be verified. */
export class ReceiptError extends PreflightError {
  constructor(reason: string, options: PreflightErrorOptions = {}) {
    super('RECEIPT', reason, options)
    this.name = 'ReceiptError'
  }
}

/** B7: a tool call arrived malformed, or the wrapped function threw. */
export class McpError extends PreflightError {
  constructor(reason: string, options: PreflightErrorOptions = {}) {
    super('MCP', reason, options)
    this.name = 'McpError'
  }
}

/** E2: the client-agent harness could not continue. */
export class HarnessError extends PreflightError {
  constructor(reason: string, options: PreflightErrorOptions = {}) {
    super('HARNESS', reason, options)
    this.name = 'HarnessError'
  }
}

/** A1, everywhere: a required configuration value is missing. There is no default. */
export class ConfigError extends PreflightError {
  constructor(reason: string, options: PreflightErrorOptions = {}) {
    super('CONFIG', reason, { ...options, retryable: false })
    this.name = 'ConfigError'
  }
}

export function isPreflightError(err: unknown): err is PreflightError {
  return err instanceof PreflightError
}

/**
 * A renderable one-liner for any thrown value.
 *
 * Every gate ends up here on its error path, so it never returns an empty string: a refusal with no
 * reason reads on screen as a bug in the gate rather than as the refusal it is.
 */
export function reasonOf(err: unknown): string {
  if (isPreflightError(err)) return err.reason
  if (err instanceof Error && err.message.length > 0) return err.message
  if (typeof err === 'string' && err.length > 0) return err
  return 'unknown failure'
}
