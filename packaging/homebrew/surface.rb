class Surface < Formula
  desc "Local-first UI audit CLI and MCP server"
  homepage "https://github.com/zigrivers/surface"
  # Replace VERSION and SHA256 from the published npm tarball before copying to the tap.
  url "https://registry.npmjs.org/@zigrivers/surface/-/surface-VERSION.tgz"
  sha256 "SHA256"
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
