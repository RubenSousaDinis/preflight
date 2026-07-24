# Lane 1 verification log: B2, receipts

Run 2026-07-25. Pure local crypto, no RPC and no key funding, so these numbers reproduce on any
machine with the repo checked out.

```
chain verified (5 receipts):  ok: true, brokenAt: null
signerPubKey:                 0xe26e72ca9e5fa0812653b1f0e09df445ce3493d96a2a0e8bc8ae6097b7dbf959
                              (generated at process start; RECEIPT_SIGNER_PRIVATE_KEY pins one
                              signer across restarts when the demo wants a stable public key)

  receipt-0001  agent/HIRE    prev null                sig ok
  receipt-0002  agent/REFUSE  prev 0x8613f3aaa778d21f… sig ok
  receipt-0003  tx/BLOCK      prev 0x4af1db514046ea25… sig ok
  receipt-0004  agent/REFUSE  prev 0x5423412cab3f1fd1… sig ok
  receipt-0005  tx/ALLOW      prev 0x6ad798b5714c85fa… sig ok

tamper detected at index:     2, "receipt-0003 subject does not hash to its responseHash"
                              (one full stop added to one reason string)
deletion detected:            yes, index 2, "receipt-0004 points at 0x5423412cab… but the receipt
                              before it hashes to 0x4af1db5140…"
signature verified standalone: yes. verifySignature(hash, sig, signerPubKey) checks out with no
                              chain, no store, and no other project state loaded. Another signer's
                              key does not verify it, a re-signed hash does not verify against the
                              original key, and a malformed signature or public key returns false
                              rather than throwing.

reproducibleFrom:             populated on both tx receipts with block, from, to, calldataHash and
                              value; null on all three agent receipts, in the same chain.
evidenceURI:                  present on an agent decision that has a record, null on a tx verdict,
                              and null on a refusal with no record, which still emits a receipt.

suite: 13 tests, all passing, offline.
```

## What breaks the chain, all checked

A single boolean would not be usable on stage, so every failure names the receipt and the field:

| Tampering | Result |
|---|---|
| a byte in a `subject` | broken at that index, subject does not hash to its responseHash |
| a receipt deleted from the middle | broken at that index, the link no longer matches |
| a recorded `hash` swapped for another receipt's | broken at that index, fields do not hash to the recorded hash |
| a `prevHash` repointed at an earlier receipt | broken at that index |
| two receipts reordered | broken |
| a second receipt with `prevHash: null` | broken, only the first receipt may open a chain |
| `methodologyVersion` edited | broken, fields do not hash to the recorded hash |
| an id reused so the order does not advance | broken |
| an empty array | not a verified chain, rather than vacuously true |

## Notes

- The canonicalizer is A3a's, imported. A second canonicalizer is how a verify path drifts from a
  write path, and the drift presents as every receipt failing for reasons nobody can locate.
- `hash` covers `prevHash` and every other field except the signature, and the signature is over
  `hash`. Signing the subject instead would leave the link unsigned and the chain reorderable.
- Ids are monotonic by counter, never by clock. A wall clock going backwards must not reorder a chain.
- Open question 1 stays at its default: the chain is session scoped and held in memory. Nothing here
  can fail on a write, because losing a receipt to a slow store is worse than an unpersisted chain.
- Open question 2: `signerPubKey` travels inside every receipt, so post-event verification needs no
  published key. Publishing one is only needed if a verifier wants to know the signer was ours.

## D5e, the HCS receipt mirror

Run 2026-07-25, on Hedera Testnet.

```
topic id / create tx:          0.0.9736592
                               0.0.9695674@1784937004.030466444
                               memo "preflight receipt chain mirror, ethglobal lisbon 2026"
explorer link:                 https://hashscan.io/testnet/topic/0.0.9736592
                               (a mirror of the signed chain, never a source)

message count vs local
receipt count at check:        5 and 5. The public mirror node REST API reports sequence_number 5 for
                               the topic, and the local chain held five receipts.
sampled message hash matches
local receipt:                 yes. The newest message decodes to
                               {"receiptId":"receipt-0005",
                                "receiptHash":"0x25614979e261ad17c72abd2ba5208cb7026dd0ed1e5f2c434a1d143836e9f3dd",
                                "index":5}
                               and the local receipt-0005 hashes to 0x25614979e261ad17…, the same value.

fire and forget, measured:     five receipts emitted in 4 ms, and the mirror state immediately after
                               read {mirrored: 0, pending: 5}. Nothing had been submitted yet, which is
                               the point: the gate produced and signed five receipts without waiting on
                               a network it does not depend on. After the flush the state read
                               {mirrored: 5, pending: 0, failed: 0}.

suite: 8 tests, all passing, offline, including that a mirror which always fails never fails the chain,
that a transient failure is retried until it lands, and that one message which never lands does not
stall the ones behind it.
```

### What is written, and what is not

One message per receipt, carrying the receipt id, its hash, and its index. Nothing else. The chain
verifies from hashes, so publishing whole receipts would add nothing and bloat every message, and the
verdict text stays where it is signed.

The write goes through the Hedera Agent Kit's own `HcsAuditTrailHook`, which is the tool 02-DECISIONS
§12 banks: the hook posts the message to the topic with the payer client. Its tool-execution wrapper is
not used, because what is being audited here is a receipt rather than one of the kit's own tool calls.
Topic creation uses the SDK's `TopicCreateTransaction`, which is the one-off half.

### Still needed

`HCS_RECEIPT_TOPIC_ID=0.0.9736592` in the Vercel environment, and the explorer link rendered beside the
receipt chain in the console labelled as a mirror, plus the same link in the README enhancements
section. Without the variable the mirror simply does not run, and the signed chain is unchanged: the
mirror is decoration on the receipts, not part of them.
