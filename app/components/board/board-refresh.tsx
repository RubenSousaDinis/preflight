"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/*
  C4 step 5: a grade that lands appears without anyone reloading.

  It re-reads the chain rather than polling a cache, so what appears is what the
  registry says. Thirty seconds rather than five because the registry read is
  several RPC calls and the event endpoint rate limits a burst; a board that
  refreshed aggressively would spend the demo showing its own read failures.

  Stoppable, because beat 4's watch is already polling and the operator may want
  the endpoint to itself.
*/
export function BoardRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  const [live, setLive] = useState(true);

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(timer);
  }, [live, router, seconds]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="font-data text-[0.72rem] text-ink/55">
        {live
          ? `re-reading the chain every ${seconds} seconds`
          : "not re-reading; the board is as of the last read"}
      </p>
      <button
        type="button"
        onClick={() => setLive((current) => !current)}
        className="border border-rule px-2 py-0.5 font-data text-[0.7rem] tracking-[0.1em] text-ink/70 hover:border-accent hover:text-accent"
      >
        {live ? "stop" : "resume"}
      </button>
    </div>
  );
}
