import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    // https://github.com/vercel/next.js/issues/10285
    // Next injects `<style data-next-hide-fouc="true">body{display:none}</style>`,
    // so we should set background on `html`
    <Html className="bg-default">
      <Head>
        <link rel="icon" href="/icons/192.png"></link>
        <PWA />
        <PreventFlash />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}

function PWA() {
  return (
    <>
      <link rel="manifest" href="/manifest.json" />
      <meta id="theme-color" name="theme-color" content={background.light} />
      <link rel="apple-touch-icon" href="/icons/192.png" />
    </>
  )
}

const background = {
  light: 'white',
  dark: '#24292e',
}

// The colour-scheme script lives in public/theme-init.js so the CSP needs no inline scripts, and
// Google Tag Manager is gone with Sentry and Dropbox: no third-party scripts (spec §17, W11).
function PreventFlash() {
  return (
    <>
      <style>{`
        .bg-default, .hover\\:bg-default:hover {
          background: ${background.light};
        }
        .dark.bg-default, .dark .bg-default, .dark .hover\\:bg-default:hover {
          background: ${background.dark};
        }
      `}</style>
      {/* eslint-disable-next-line @next/next/no-sync-scripts -- must run before first paint */}
      <script src="/theme-init.js" />
    </>
  )
}
