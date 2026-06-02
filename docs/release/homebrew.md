# Homebrew Release Setup

The initial Homebrew distribution should use a custom tap instead of `homebrew/core`.

## Tap

Target tap:

```bash
brew tap zigrivers/surface
brew install surface
```

Formula source template: `packaging/homebrew/surface.rb`.

## Release Flow

1. Publish `@zigrivers/surface` to npm.
2. Create the GitHub release tag, for example `v0.1.0`.
3. Compute the npm tarball checksum:

   ```bash
   npm view @zigrivers/surface@0.1.0 dist.tarball dist.shasum dist.integrity
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
