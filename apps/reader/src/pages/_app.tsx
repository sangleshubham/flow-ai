import './styles.css'
import 'react-photo-view/dist/react-photo-view.css'
import 'katex/dist/katex.min.css'
import '../illustrate/styles.css'

import { LiteralProvider } from '@literal-ui/core'
import type { AppProps } from 'next/app'
import { useRouter } from 'next/router'
import { Component as ReactComponent } from 'react'
import { RecoilRoot } from 'recoil'

import { Layout, Theme } from '../components'

// @literal-ui/core types predate @types/react 18, which dropped implicit `children` from React.FC.
const Provider = LiteralProvider as React.FC<React.PropsWithChildren>

export default function MyApp({ Component, pageProps }: AppProps) {
  const router = useRouter()

  // The login page renders without the reader shell (no Dexie, no layout) (W11, §17).
  if (router.pathname === '/login') return <Component {...pageProps} />

  return (
    <ErrorBoundary>
      <Provider>
        <RecoilRoot>
          <Theme />
          <Layout>
            <Component {...pageProps} />
          </Layout>
        </RecoilRoot>
      </Provider>
    </ErrorBoundary>
  )
}

// Replaces Sentry's boundary (W11 removed Sentry): errors stay on this machine.
class ErrorBoundary extends ReactComponent<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? <div>Something went wrong.</div> : this.props.children
  }
}
