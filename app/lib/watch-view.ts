import type { Grade } from "@/src/shared";

/*
  Beat 4's frames.

  A surface shape rather than a contract shape: the watcher and the gate are Lane
  1's, and what a screen needs from them (a poll, and every client's verdict at the
  same instant) is this file's business, not theirs.
*/

export type WatchObservation = {
  at: number;
  agentId: string;
  declaredVersion: string | null;
  fingerprint: string | null;
  /** Set when any part of the observation failed. Kept for the operator's log. */
  error: string | null;
  /**
   * The two channels fail independently, so they are rendered independently.
   *
   * Reading only `error` was a fail-open on this surface: the demo target's version
   * read fails on every poll, so a real fingerprint drift rendered as "could not
   * check" and the one signal the beat exists to show was hidden behind a caveat
   * about the other channel.
   */
  fingerprintError: string | null;
  versionError: string | null;
  changed: boolean;
  changeKind: "version" | "fingerprint" | "both" | null;
};

export type ClientVerdict = {
  client: string;
  verdict: "HIRE" | "REFUSE";
  reason: string;
  grade: Grade | null;
  fingerprintMatch: boolean | null;
};

export type WatchFrame =
  | { kind: "observation"; observation: WatchObservation }
  /** Every client's answer at one instant. Simultaneity is the claim. */
  | { kind: "clients"; at: number; clients: ClientVerdict[] }
  | { kind: "failed"; reason: string }
  | { kind: "closed"; reason: string };
