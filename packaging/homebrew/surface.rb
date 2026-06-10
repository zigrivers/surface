# frozen_string_literal: true

# Surface Homebrew formula.
class Surface < Formula
  desc "Local-first UI audit CLI and MCP server"
  homepage "https://github.com/zigrivers/surface"
  # Keep URL and sha256 in sync with the published @zigrivers/surface npm tarball.
  url "https://registry.npmjs.org/@zigrivers/surface/-/surface-0.2.3.tgz"
  sha256 "5f3d54bdea06a185cbff1f0ebc64f2b09b32cec9d3471a6ea5e41fef13bffd84"
  license "MIT"

  depends_on "node@22"

  def install
    system "npm", "install", *std_npm_args, "--min-release-age=0"
    bin.install_symlink libexec/"bin/surface"
  end

  test do
    assert_match "surface", shell_output("#{bin}/surface --help")
  end
end
