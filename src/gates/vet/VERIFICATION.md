# Lane 1 verification log: B1, the agent boundary

Run 2026-07-25.

```
check 1 (hire):                     HIRE, fingerprintMatch true, grade B, score 75.
                                    Run against the real demo server over the wire, with only the
                                    registry read stubbed: the evidence was published to 0G Storage
                                    and fetched back over HTTP, the responseHash was recomputed from
                                    what came back, and the live surface was enumerated through the
                                    engine.
check 2 (refuse below policy):      REFUSE, "grade F is below the minimum of B", fingerprintMatch
                                    true. The surface matched; only the letter failed, and the
                                    reason says so rather than blaming drift.
check 3 (refuse on a flipped
        fingerprint):               REFUSE, grade B still showing, fingerprintMatch false, reason
                                    carrying both values: live 0x8f29986…, graded 0x9bd0a25….
                                    Flipped back, the same agent was hired again. The verdict
                                    tracked the flip in both directions, which is B1 step 9 with
                                    the surface running in its own process, flipped over its
                                    control endpoint rather than in ours.
check 4 (pagination changes
        the hash):                  the first page alone (10 of 21 tools) fingerprints differently
                                    from the whole surface. A one-page read cannot produce the full
                                    fingerprint, which is the defect that would otherwise look like
                                    a working gate.

the full cycle, values from the run:
  target                            http://127.0.0.1:8787/mcp (E1, baseline)
  grade                             B, score 75, litmus-v17
  toolFingerprint (graded)          0x9bd0a254230b7b605801df23e9c69831975e7d9060d97a1ea90a5c2daa3c2eac
  live fingerprint (drifted)        0x8f2998682fbbfafa…
  evidence via 0G Storage           11181 bytes, hash 0xb88b9371cbad3a6861da698d284bce9204e5e1a60487177b89d595b2f3eab485
                                    content address 0xbf24d308a3ff8b86aaaca6c051cc65b2248fd78504f5b8c2c5f9695500d72b28
  the same cycle via the data URI
  degrade                           11181 bytes, hash 0xd13b11f0b810b776752dcfeefd0260cdf8002f83bc4939bf6d9a97cdfc65bb9b
                                    (a different hash because ranAt differs between two grades,
                                    which is the bundle describing when it ran)
  receipts                          3, chain verified, signer
                                    0x52968da12a31c683f24a6272341021b8d0bafd7e981c122487560cd91951a48b

refusal causes exercised:           twelve, each with a distinguishable reason, asserted as a set so
                                    two causes can never read the same:
                                      registry unreadable, no record, record from another validator,
                                      expired (policy bound tighter than the derived one), a score
                                      off the 25-point scale, a record pointing at no evidence,
                                      evidence unreachable, evidence hash mismatch, evidence that is
                                      not a bundle, live fingerprint unobtainable, drift, and grade
                                      below policy.
                                    Removal is drift too: a live surface that is a strict subset of
                                    the graded one refuses.

suite: 11 tests for this task, all passing, offline.
```

## The gate against the live registry

`vet 8427`, the real read path against A4's deployed registry, no stubs:

```
agent 8427: REFUSE
  grade             A  score 100
  fingerprintMatch  null (unobtainable, which refuses)
  reason            evidence hash mismatch for agent 8427: the published bundle hashes to
                    0x6914e915…1ecd, the record says 0x09f75be2…4f16
  receipt           receipt-0001, responseHash 0x57b5438dcc55bf65ea7a055967c0af3e12058b731aeaac89b47f28bc600a2d6b
  signer            0x6538479b3abb03df924d653af86bf0962de9e59bc58bfb541367c9c3499e53aa
```

That is the correct verdict on that record. The smoke record's throwaway evidence genuinely does not
hash to its responseHash, and the gate says which two values disagree rather than falling back to the
onchain score, which would have hired an A on a document nobody can check.

Note what the run shows about ordering: the letter reads A and the verdict is still REFUSE. The grade
is a claim about a past surface, and the gate refuses before it ever reaches the letter.

## What still needs the operator

Checks 1 to 3 above ran with the registry read stubbed, because publishing a record needs the
validator key and the agent owner's key. Once D1 registers the demo agents and A3b publishes their
records, the same three checks run with nothing stubbed:

```
node --env-file-if-exists=.env.local src/gates/vet/cli.ts vet <agentId>
```

The flip cycle itself needs no key and is already proven. What the deployed version adds is the URL:
E1 is running locally here, and its two route files are still Lane 3's to add (`src/demo/README.md`).
