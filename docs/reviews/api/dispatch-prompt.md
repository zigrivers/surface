You are an independent senior architect performing an adversarial review of the interface
contracts for "surface" — an open-source CLI + MCP server that audits the built, running UI of
web apps. NOTE: surface has NO REST/GraphQL API (ADR-008); its contracts are the POSIX CLI, the
MCP tool surface, and machine output schemas (findings.json, SARIF). Judge it on THAT basis —
do not demand REST endpoints.

REVIEW TARGET: `docs/api-contracts.md`. Read it from disk. CONTEXT (read as needed):
`docs/domain-models/`, `docs/adrs/` (esp. ADR-008/014/016), `docs/system-architecture.md`,
`docs/plan.md`.

Review these API-specific failure modes, adapted to CLI/MCP:
1. Operation coverage — every domain operation that crosses the CLI/MCP boundary maps to a
   command AND an MCP tool; nothing missing.
2. Error-contract completeness — every command/tool has a consistent error envelope, ≥2
   domain-specific error codes with human-readable reason phrases, mapped to exit codes / MCP errors.
3. Auth/data requirements — auth-state injection (FR-CAP-8) handled on both CLI and MCP; BYO-key
   and no-exfiltration honored.
4. Versioning consistency — CLI semver, findings.json schemaVersion, MCP schema major-bump rule
   (NFR-MCP-1) consistent with ADRs.
5. Idempotency/determinism — mutating operations re-runnable; measured determinism stated.
6. Payload/domain fidelity — the Finding/Backlog/GateResult/SARIF schemas match the domain model
   (e.g. method, severityBand, gatedForHuman, FindingStatus, GateDisposition).

Be skeptical and specific; cite the section. P0 blocks downstream; P1 rework; P2 debt; P3 polish.

OUTPUT: emit ONLY a JSON object:
{ "reviewer":"<model>", "overall":"<2-3 sentences>",
  "findings":[ {"severity":"P0|P1|P2|P3","pass":"<mode>","location":"<section>","finding":"<issue>","suggestion":"<fix>"} ],
  "gate":"pass|conditional-pass|fail" }
