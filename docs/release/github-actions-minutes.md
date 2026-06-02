# GitHub Actions Minute Policy

Surface uses a local-first release workflow to avoid routine GitHub-hosted Actions usage.

## Policy

- Routine development gates run locally with `pnpm run check` and `pnpm run release:verify`.
- Pull request and push workflows must not run automatically by default.
- GitHub-hosted Actions are allowed only for explicit manual verification or release publication.
- Release publication may use GitHub-hosted Actions because npm trusted publishing and provenance rely on GitHub Actions OIDC.
- Workflows must use standard Linux runners only, short timeouts, `concurrency.cancel-in-progress`, and short artifact retention.
- No scheduled workflows, OS matrices, larger runners, or macOS/Windows runners are allowed without a new Beads issue and explicit approval.

## Tradeoff

This policy targets zero routine GitHub-hosted CI minutes. The accepted exception is a bounded, manually-triggered release workflow for npm trusted publishing/provenance. If the project chooses absolute zero GitHub Actions usage, npm publishing must use a manual/token-based fallback and provenance may be weaker.

## Required Local Gates

```bash
pnpm run check
pnpm run release:verify
```

Agents must paste local validation output into PRs or release handoffs instead of relying on automatic CI.

