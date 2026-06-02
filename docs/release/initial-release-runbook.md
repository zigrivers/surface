# Initial Release Runbook

## Pre-Tag Checks

```bash
git fetch origin --prune
git status --short
pnpm install --frozen-lockfile
pnpm run check
pnpm run release:verify
```

The release branch must be clean before tagging.

## GitHub Actions Usage

Expected routine GitHub-hosted Actions usage: zero minutes.

Expected release usage: one manual `release.yml` run on `ubuntu-latest` if npm trusted publishing/provenance is used.

## npm

Verify npm trusted publisher configuration for every package listed in `docs/release/npm.md`, then run the manual release workflow with `publish=true`.

## Homebrew

After npm publication, update the custom tap formula from `packaging/homebrew/surface.rb`, compute the checksum, and run the local Homebrew validation commands from `docs/release/homebrew.md`.

