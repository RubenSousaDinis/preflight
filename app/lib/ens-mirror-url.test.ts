import assert from "node:assert/strict";
import test from "node:test";
import {
  ENS_MIRROR_CHAIN_ID,
  ENS_MIRROR_CHAIN_LABEL,
  baseSepoliaAddressUrl,
  baseSepoliaTxUrl,
  ensResolverReadUrl,
} from "./ens-mirror-url";

const RESOLVER = "0x6533C94869D28fAA8dF77cc63f9e2b2D6Cf77eBA";

test("record links point at the Base Sepolia resolver, never at the ENS App", () => {
  const url = ensResolverReadUrl(RESOLVER);
  assert.equal(
    url,
    `https://sepolia.basescan.org/address/${RESOLVER}#readContract`,
  );
  // The bug this module exists to close: an ENS App link resolves through L1, where every key on
  // these names reads null, and a reader concludes the write never landed.
  assert.ok(!url.includes("app.ens.domains"));
});

test("the mirror chain is named once", () => {
  assert.equal(ENS_MIRROR_CHAIN_ID, 84532);
  assert.equal(ENS_MIRROR_CHAIN_LABEL, "Base Sepolia (Basenames)");
});

test("address and tx links point at sepolia.basescan", () => {
  const hash = `0x${"ab".repeat(32)}`;
  assert.equal(baseSepoliaTxUrl(hash), `https://sepolia.basescan.org/tx/${hash}`);
  assert.equal(
    baseSepoliaAddressUrl(` ${RESOLVER} `),
    `https://sepolia.basescan.org/address/${RESOLVER}`,
  );
});
