/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Keep the same production limit across the browser proxy and API.
    proxyClientMaxBodySize: '120mb',
    // Letter previews convert docx -> PDF through LibreOffice (appointment
    // letters may need several page-fit passes, 30-90s+). The default rewrite
    // proxy timeout aborts those requests and returns its own 500.
    proxyTimeout: 300_000,
  },
  images: {
    unoptimized: true,
  },
  async rewrites() {
    const apiOrigin = process.env.BACKEND_API_ORIGIN ?? 'http://localhost:8000'

    return [
      {
        source: '/api/v1/:path*',
        destination: `${apiOrigin}/api/v1/:path*`,
      },
    ]
  },
  headers: async () => {
    return [
      {
        source: '/favicon(.*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate',
          },
        ],
      },
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains',
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
        ],
      },
    ]
  },
}

export default nextConfig
