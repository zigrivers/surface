class Surface < Formula
  desc "Local-first UI audit CLI and MCP server"
  homepage "https://github.com/zigrivers/surface"
  url "https://registry.npmjs.org/@zigrivers/surface/-/surface-0.1.1.tgz"
  sha256 "fd53bbece7abb0a7e625cb05bc345e6399bd2317a9c684a9ee9a9f267dccaf7e"
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
