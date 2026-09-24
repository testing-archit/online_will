import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Self-hosted on the VM as a long-running `next start` process, not Vercel --
  // standalone output keeps the production node_modules footprint small and
  // matches the systemd-service deployment pattern already used there.
  output: 'standalone',
  // A stray bun.lock in a parent directory (outside this repo) otherwise makes
  // Turbopack guess the wrong monorepo root.
  turbopack: { root: __dirname },
}

export default nextConfig
