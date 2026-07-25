import { configuredTopicId, readMirrorNode } from "@/src/receipts/hcs-mirror";
import { toRenderableError, type RenderableError } from "./errors";

export type MirrorStatus = {
  topicId: string | null;
  messages: number | null;
  /** HashScan, so the topic can be opened by anyone in the room. */
  explorerUrl: string | null;
  error: RenderableError | null;
};

/*
  The HCS mirror of the receipt chain (D5e).

  A mirror and never a source. A reader that trusted the topic over the chain would
  have inverted the trust order, so this is labelled as a mirror wherever it renders
  and nothing on this surface reads a verdict from it.

  The count is read back from a public mirror node rather than from what we believe
  we sent, which is the only version of the claim worth putting on screen.
*/
export async function readMirrorStatus(): Promise<MirrorStatus> {
  const topicId = configuredTopicId();
  if (topicId === null) {
    return { topicId: null, messages: null, explorerUrl: null, error: null };
  }

  const explorerUrl = `https://hashscan.io/testnet/topic/${topicId}`;
  try {
    const count = await readMirrorNode(topicId);
    return {
      topicId,
      messages: count.messages,
      explorerUrl,
      error: null,
    };
  } catch (thrown) {
    return {
      topicId,
      messages: null,
      explorerUrl,
      error: toRenderableError(thrown),
    };
  }
}
