# frozen_string_literal: true

# Surface Homebrew formula.
class Surface < Formula
  desc "Local-first UI audit CLI and MCP server"
  homepage "https://github.com/zigrivers/surface"
  # Keep URL and sha256 in sync with the published @zigrivers/surface npm tarball.
  url "https://registry.npmjs.org/@zigrivers/surface/-/surface-0.2.4.tgz"
  sha256 "b9698775b66507b8f5d20a9a1823309dde61be1ccd860a086aacbfe3f1906314"
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
