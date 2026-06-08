# Homebrew Release Setup

The initial Homebrew distribution should use a custom tap instead of `homebrew/core`.

## Tap

Target tap:

```bash
brew tap zigrivers/surface
brew install surface
```

Formula source template: `packaging/homebrew/surface.rb`. The template uses `VERSION` and `SHA256`
placeholders so it cannot be copied with stale release metadata.

## Release Flow

1. Create and push the GitHub release tag, for example `v0.2.0`.
2. Run the manual release workflow with `publish=true` and wait for npm publication to complete.
3. Compute the published npm tarball checksum:

   ```bash
   TARBALL_URL=$(npm view @zigrivers/surface@0.2.0 dist.tarball)
   curl -L "$TARBALL_URL" -o /tmp/surface-0.2.0.tgz
   shasum -a 256 /tmp/surface-0.2.0.tgz
   ```

4. Update the tap formula URL and checksum.
5. Validate the formula after it is in the tap:

   ```bash
   ruby -c Formula/surface.rb
   brew install --build-from-source zigrivers/surface/surface
   brew test zigrivers/surface/surface
   brew audit --new --formula zigrivers/surface/surface
   ```

Homebrew 5 disables `brew audit` by local formula path, so the audit step runs against the formula name in the tap.

## Minute Policy

Homebrew formula validation is local by default. Do not add scheduled or automatic GitHub Actions for the tap unless a separate Beads issue approves the minute budget.
