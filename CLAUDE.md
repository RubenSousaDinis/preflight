@AGENTS.md

# Preflight — build rules for agents working this repo

This is an ETHGlobal Lisbon 2026 Classic-track submission. Every line of project code here is
authored inside the event window; see `README.md` for the disclosed prior inputs.

- `@polygraphso/litmus` is consumed exactly like any other npm dependency. Read its published
  package (types, README) only. Never open, read, or reproduce polygraph's internal source (the
  `litmus`, `hosted-service`, or `core` repositories, or any pre-event draft implementation of
  this project) from context or memory. Reproducing either breaches Classic-track eligibility
  exactly as copying files would.
- Fail closed everywhere. A gate or verdict that defaults to permission on an error path is a
  correctness bug against the product thesis, not a rough edge.
- Copy rules, on every surface (UI, README, commit messages, code comments):
  - No em dashes or en dashes anywhere in visible text.
  - Banned: "safe", "secure", "guaranteed", "100%", "the heist nets nothing", "novel simulation",
    "TEE proof-of-execution". Prefer "checks", "blocks this action", "reproducible evidence".
  - Reproducibility means a false grade is falsifiable by re-running the open engine, never that
    it was independently re-run by someone else.
  - Disclosed limits belong in the UI, not only this README: evasion (a target that detects the
    test context and behaves), and that a transaction verdict is reproducible for a given block
    and state, not a prediction of the landed outcome.
