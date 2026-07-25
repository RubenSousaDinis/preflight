/**
 * Which variant the demo server is currently serving.
 *
 * The flip has to be instant and idempotent: setting a variant twice is one state, and the next
 * `tools/list` reflects it with no restart, because a flip that needs a redeploy cannot be driven
 * from the stage.
 *
 * The store is an interface with a memory implementation because of where this runs. A serverless
 * deployment can answer two requests from two instances, and a flip written into one instance's
 * memory is invisible to the other, so a run could start already drifted with nobody able to explain
 * it. The memory store is correct locally and correct on a warm instance; a durable backend plugs in
 * here without touching the server, and the operator request for one is in this directory's README.
 *
 * Reading the current variant is public. Writing is not: an open flip switch on a public URL lets
 * anyone change the surface under a live grade, so a write without a configured token is refused.
 */

import { ConfigError, PreflightError } from '../shared/errors.ts'
import type { ToolSurfaceVariant } from '../shared/types.ts'
import { isVariant } from './tool-surface.ts'

export interface VariantStore {
  read(): Promise<ToolSurfaceVariant>
  write(variant: ToolSurfaceVariant): Promise<void>
}

/**
 * The version the server declares about itself, in the MCP handshake.
 *
 * Deliberately separate from the variant, so each variant still moves exactly one axis. A version is
 * metadata the server asserts, and an operator sets it explicitly: a target that ships an update and
 * bumps its version is the ordinary case, and one that changes behaviour without bumping is the sneaky
 * case. Beat 4 needs both, which is why this is its own knob rather than a side effect of a flip.
 */
export const DEFAULT_DECLARED_VERSION = '1.0.0'
let declaredVersion = DEFAULT_DECLARED_VERSION

export function currentDeclaredVersion(): string {
  return declaredVersion
}

export function setDeclaredVersion(version: string): void {
  const trimmed = version.trim()
  if (trimmed.length === 0) throw new PreflightError('HARNESS', 'a declared version cannot be empty')
  declaredVersion = trimmed
}

export const DEFAULT_VARIANT: ToolSurfaceVariant = 'baseline'

export class MemoryVariantStore implements VariantStore {
  #variant: ToolSurfaceVariant

  constructor(initial: ToolSurfaceVariant = DEFAULT_VARIANT) {
    this.#variant = initial
  }

  async read(): Promise<ToolSurfaceVariant> {
    return this.#variant
  }

  async write(variant: ToolSurfaceVariant): Promise<void> {
    this.#variant = variant
  }
}

let store: VariantStore = new MemoryVariantStore()

/** Swaps the backing store. The durable backend registers itself here at startup. */
export function useVariantStore(next: VariantStore): void {
  store = next
}

/** 01-INTERFACES §12. */
export async function setToolSurface(variant: ToolSurfaceVariant): Promise<void> {
  if (!isVariant(variant)) {
    throw new PreflightError('HARNESS', `${JSON.stringify(variant)} is not a tool surface variant`)
  }
  await store.write(variant)
}

/** Readable state, so the operator confirms the variant before a run instead of inferring it. */
export async function currentToolSurface(): Promise<ToolSurfaceVariant> {
  return store.read()
}

/** Test and stage support: back to the graded surface in one call. */
export async function resetToolSurface(): Promise<void> {
  await store.write(DEFAULT_VARIANT)
  declaredVersion = DEFAULT_DECLARED_VERSION
}

/**
 * The token a flip must present.
 *
 * Absent means writes are refused. The demo server sits on a public URL, and a surface anyone can
 * change is a surface no grade describes.
 */
export function controlToken(): string {
  const token = process.env.DEMO_CONTROL_TOKEN?.trim()
  if (token === undefined || token.length === 0) {
    throw new ConfigError(
      'DEMO_CONTROL_TOKEN is not set, so the tool surface cannot be flipped: an open flip switch on a public URL lets anyone change the surface under a live grade',
    )
  }
  return token
}

export function authorizeControl(header: string | null): void {
  const expected = controlToken()
  const presented = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null
  if (presented === null || presented !== expected) {
    throw new PreflightError('HARNESS', 'the flip was not authorized')
  }
}
