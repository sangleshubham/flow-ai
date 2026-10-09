const path = require('path')

const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
})
const { securityHeaders, runtimeCaching } = require('./security-headers')

const IS_DEV = process.env.NODE_ENV === 'development'
const IS_DOCKER = process.env.DOCKER

const withPWA = require('next-pwa')({
  dest: 'public',
  disable: IS_DEV,
  runtimeCaching: runtimeCaching(),
})
const withTM = require('next-transpile-modules')([
  '@flow/internal',
  '@flow/epubjs',
  '@material/material-color-utilities',
  '@illus/core',
  '@illus/llm',
])


/**
 * @type {import('next').NextConfig}
 **/
const config = {
  pageExtensions: ['ts', 'tsx'],
  poweredByHeader: false,
  // Flow does not use next/image; this also keeps the image optimiser and its advisories off (ADR 0005).
  images: { unoptimized: true },
  async headers() {
    return securityHeaders({ dev: IS_DEV })
  },
  webpack(config) {
    // docs/prompts/<role>.md imported as raw text at build time (spec §9, W2).
    config.module.rules.push({
      test: /[\\/]docs[\\/]prompts[\\/][^\\/]+\.md$/,
      type: 'asset/source',
    })
    return config
  },
  // Sign in with ChatGPT stays at /auth/chatgpt/* (spec §9); the Pages Router serves it under /api.
  // No `locale: false`: with i18n, Next 12.3 inserts the default locale before matching, so a
  // locale-free source never matches. This form serves /auth/… and /<locale>/auth/… (ADR 0007, W2).
  async rewrites() {
    return [
      {
        source: '/auth/chatgpt/:action',
        destination: '/api/auth/chatgpt/:action',
      },
    ]
  },
  i18n: {
    locales: ['en-US', 'zh-CN', 'ja-JP', 'de-DE'],
    defaultLocale: 'en-US',
  },
  experimental: {
    // Lets src/middleware.ts answer 401/429 with a JSON body (Next 12.3; stable from 13).
    allowMiddlewareResponseBody: true,
    ...(IS_DOCKER && { outputFileTracingRoot: path.join(__dirname, '../../') }),
  },
  ...(IS_DOCKER && { output: 'standalone' }),
}

module.exports = withPWA(withTM(withBundleAnalyzer(config)))
