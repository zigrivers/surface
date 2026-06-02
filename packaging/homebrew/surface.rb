class Surface < Formula
  desc "Local-first UI audit CLI and MCP server"
  homepage "https://github.com/zigrivers/surface"
  url "https://registry.npmjs.org/@zigrivers/surface/-/surface-0.1.0.tgz"
  sha256 "REPLACE_WITH_NPM_TARBALL_SHA256"
  license "MIT"

  depends_on "node@22"

  def install
    system "npm", "install", *std_npm_args(prefix: false), "."
    bin.install_symlink libexec/"bin/surface"
  end

  test do
    assert_match "surface", shell_output("#{bin}/surface --help")
  end
end

