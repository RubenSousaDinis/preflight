import assert from "node:assert/strict";
import test from "node:test";
import { ENS_APP_CHAIN_ID, baseSepoliaTxUrl, ensAppUrl } from "./ens-app-url";

test("ensAppUrl pins Base Sepolia so TXT records resolve on the mirror chain", () => {
  assert.equal(
    ensAppUrl("agent8443.preflight.basetest.eth"),
    "https://app.ens.domains/agent8443.preflight.basetest.eth?chainId=84532",
  );
  assert.equal(ENS_APP_CHAIN_ID, 84532);
  assert.equal(
    ensAppUrl("Agent8443.Preflight.Basetest.ETH"),
    "https://app.ens.domains/agent8443.preflight.basetest.eth?chainId=84532",
  );
});

test("baseSepoliaTxUrl points at sepolia.basescan", () => {
  const hash = `0x${"ab".repeat(32)}`;
  assert.equal(
    baseSepoliaTxUrl(hash),
    `https://sepolia.basescan.org/tx/${hash}`,
  );
});
