import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /**
   * `next build` and `next dev` share `.next` by default, so running a
   * verification build while the dev server is up replaces the chunks the
   * running server is still serving — the browser then 404s on every script and
   * stylesheet and the page loads unstyled and dead.
   *
   * `npm run build:check` sets NEXT_DIST_DIR so a verification build writes
   * somewhere else and leaves a running dev server alone.
   */
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ['@prisma/client', 'pdfkit', 'cheerio'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
