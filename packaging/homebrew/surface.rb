class Surface < Formula
  desc "Local-first UI audit CLI and MCP server"
  homepage "https://github.com/zigrivers/surface"
  url "https://registry.npmjs.org/@zigrivers/surface/-/surface-0.1.0.tgz"
  sha256 "105a3c8f98a1ee2a0bc194b7cb01e0a6ed0454c7500423b169c0d7591d7867ec"
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
