const path = require('path')

const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
})
const { withSentryConfig } = require('@sentry/nextjs')
const withPWA = require('next-pwa')({
  dest: 'public',
})
const withTM = require('next-transpile-modules')([
  '@flow/internal',
  '@flow/epubjs',
  '@material/material-color-utilities',
  '@illus/core',
  '@illus/llm',
])

const IS_DEV = process.env.NODE_ENV === 'development'
const IS_DOCKER = process.env.DOCKER

/**
 * @type {import('@sentry/nextjs').SentryWebpackPluginOptions}
 **/
const sentryWebpackPluginOptions = {
  // Additional config options for the Sentry Webpack plugin. Keep in mind that
  // the following options are set automatically, and overriding them is not
  // recommended:
  //   release, url, org, project, authToken, configFile, stripPrefix,
  //   urlPrefix, include, ignore

  silent: true, // Suppresses all logs
  // For all available options, see:
  // https://github.com/getsentry/sentry-webpack-plugin#options.
}

/**
 * @type {import('next').NextConfig}
 **/
const config = {
  pageExtensions: ['ts', 'tsx'],
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
  ...(IS_DOCKER && {
    output: 'standalone',
    experimental: {
      outputFileTracingRoot: path.join(__dirname, '../../'),
    },
  }),
}

const base = withPWA(withTM(withBundleAnalyzer(config)))

const dev = base
const docker = base
const prod = withSentryConfig(
  base,
  // Make sure adding Sentry options is the last code to run before exporting, to
  // ensure that your source maps include changes from all other Webpack plugins
  sentryWebpackPluginOptions,
)

module.exports = IS_DEV ? dev : IS_DOCKER ? docker : prod
