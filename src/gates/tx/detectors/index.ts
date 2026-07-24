/**
 * The detectors, in the order they run.
 *
 * The set is closed at four: drainer approval, honeypot, bad callee, owner or upgrade backdoor
 * (02-DECISIONS section 6). The answer to an attack this list does not cover is new input to these
 * detectors, never a fifth detector. Widening the list is how a firewall turns into a grader, and
 * that is a different product with a worse credibility problem.
 */

import type { Detector } from '../../../shared/types.ts'
import { badCallee } from './bad-callee.ts'
import { drainerApproval } from './drainer-approval.ts'
import { ownerBackdoor } from './owner-backdoor.ts'

export const DETECTORS: Detector[] = [drainerApproval, ownerBackdoor, badCallee]

export { badCallee, drainerApproval, ownerBackdoor }
