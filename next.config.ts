import type { NextConfig } from "next";

// The visitor's Anthropic key lives in web storage, so framing, MIME sniffing and injected
// <base>/<form>/<object> targets are all shut off. Scripts are not restricted by CSP here:
// Next's inline bootstrap and the Stockfish WASM worker would need 'unsafe-inline' and
// 'wasm-unsafe-eval' anyway. The engine is single-threaded, so COOP/COEP aren't needed.
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
