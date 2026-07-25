import type { MirrorStatus } from "../../lib/hcs";

/*
  One line: the receipt chain is mirrored to a Hedera consensus topic, and here is
  the topic anyone can read it from.

  The word mirror is doing work. The chain on this page is the record; the topic is
  a copy of it published where nobody involved controls the ordering. A reader that
  preferred the topic to the chain would have the trust order backwards, so the line
  says which is which.
*/
export function MirrorLine({ status }: { status: MirrorStatus }) {
  if (status.topicId === null) {
    return (
      <p className="font-data text-[0.74rem] text-ink/50">
        no consensus topic configured, so this chain is not mirrored
      </p>
    );
  }

  return (
    <div className="border border-rule bg-band/40 px-4 py-3 sm:px-5">
      <p className="font-data text-[0.64rem] uppercase tracking-[0.16em] text-ink/50">
        mirrored to hedera consensus service
      </p>
      <p className="mt-1 font-data text-[0.85rem] break-all">
        topic{" "}
        <a
          href={status.explorerUrl ?? undefined}
          target="_blank"
          rel="noreferrer noopener"
          className="text-accent"
        >
          {status.topicId}
        </a>
      </p>
      <p className="mt-2 text-[0.85rem] leading-snug text-ink/70">
        {status.error
          ? `The mirror node could not be read, so the count here is unknown rather than assumed: ${status.error.reason}`
          : status.messages === null
            ? "The mirror node reported no count."
            : `${status.messages} message${status.messages === 1 ? "" : "s"} on the topic, read back from a public mirror node rather than from what this surface believes it sent.`}
      </p>
      <p className="mt-2 text-[0.82rem] leading-snug text-ink/60">
        A mirror, not a source. The signed chain above is the record; the topic is a
        copy published where nobody here controls the ordering. Trusting the topic
        over the chain would have it backwards.
      </p>
    </div>
  );
}
