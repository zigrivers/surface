# Homebrew Release Setup

The initial Homebrew distribution should use a custom tap instead of `homebrew/core`.

## Tap

Target tap:

```bash
brew tap zigrivers/surface
brew install surface
```

Formula source: `packaging/homebrew/surface.rb`. Keep its tarball URL and `sha256` pinned to the
current published `@zigrivers/surface` npm tarball before copying it to the tap.

## Release Flow

1. Create and push the GitHub release tag, for example `v0.2.3`.
2. Run the manual release workflow with `publish=true` and wait for npm publication to complete.
3. Compute the published npm tarball checksum:

   ```bash
   TARBALL_URL=$(npm view @zigrivers/surface@0.2.3 dist.tarball)
   curl -L "$TARBALL_URL" -o /tmp/surface-0.2.3.tgz
   shasum -a 256 /tmp/surface-0.2.3.tgz
   ```

4. In the Surface repository, update `packaging/homebrew/surface.rb` with the tarball URL and
   checksum.
5. From the Surface repository, verify the checked-in formula checksum against the published tarball:

   ```bash
   pnpm run release:verify:homebrew
   ```

   `pnpm run release:verify` also runs this check with `--allow-unpublished` so pre-publish release
   validation can pass before the new tarball exists. In network-restricted environments, set
   `SURFACE_SKIP_HOMEBREW_NETWORK_VERIFY=1` and run the strict command above before copying the
   formula to the tap.

6. Copy the updated formula to the tap, then validate it after it is in the tap:

   ```bash
   ruby -c Formula/surface.rb
   brew install --build-from-source zigrivers/surface/surface
   brew test zigrivers/surface/surface
   brew audit --new --formula zigrivers/surface/surface
   ```

Homebrew 5 disables `brew audit` by local formula path, so the audit step runs against the formula name in the tap.

## Minute Policy

Homebrew formula validation is local by default. Do not add scheduled or automatic GitHub Actions for the tap unless a separate Beads issue approves the minute budget.
