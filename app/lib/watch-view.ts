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
  error: string | null;
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
