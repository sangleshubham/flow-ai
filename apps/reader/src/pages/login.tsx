// Login gate (spec §17 as amended by ADR 0020 and ADR 0047). Two ways in, both for the one allowed account:
// - "Continue with ChatGPT" (W2's OAuth routes): a redirect on 127.0.0.1, or pasting the loopback address
//   back on a remote reader. The first account to sign in becomes the owner unless ILLUS_ALLOWED_ACCOUNT_ID is set;
// - an optional password (ILLUS_LOGIN_PASSWORD), once the owner is known.
import type { GetServerSideProps } from 'next'
import Head from 'next/head'

import { MIN_PASSWORD_LENGTH, safeNext } from '../security/login'

interface Props {
  chatgpt: boolean
  password: boolean
  next: string
  error: string | null
}

const ERRORS: Record<string, string> = {
  password: 'Wrong password.',
  busy: 'Too many attempts. Wait a minute and try again.',
  config: 'Login is not configured on this server. See docs/deploy.md.',
}

export default function Login({ chatgpt, password, next, error }: Props) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white p-6 text-gray-900">
      <Head>
        <title>Sign in</title>
        <meta name="robots" content="noindex" />
      </Head>
      <div className="w-full max-w-xs space-y-4">
        <h1 className="text-xl font-semibold">Sign in</h1>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {ERRORS[error] ?? 'Sign-in failed.'}
          </p>
        )}
        {chatgpt && (
          <a
            href="/auth/chatgpt/start"
            className="block w-full rounded-md bg-black px-4 py-2.5 text-center font-medium text-white hover:bg-gray-800"
          >
            Continue with ChatGPT
          </a>
        )}
        {password && (
          <form method="post" action="/api/login" className="space-y-3">
            <input type="hidden" name="next" value={next} />
            <label className="block text-sm">
              Password
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                autoFocus={!chatgpt}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
              />
            </label>
            <button
              type="submit"
              className="block w-full rounded-md border border-black px-4 py-2.5 font-medium hover:bg-gray-100"
            >
              Continue with password
            </button>
          </form>
        )}
        {!chatgpt && !password && <p className="text-sm">{ERRORS.config}</p>}
      </div>
    </main>
  )
}

export const getServerSideProps: GetServerSideProps<Props> = async ({ query, res }) => {
  res.setHeader('Cache-Control', 'no-store')
  const env = process.env
  const secret = (env.ILLUS_SESSION_SECRET?.length ?? 0) >= 32
  const owner = !!env.ILLUS_ALLOWED_ACCOUNT_ID?.trim()
  return {
    props: {
      chatgpt: secret && !!env.ILLUS_TOKEN_ENC_KEY,
      password: secret && owner && (env.ILLUS_LOGIN_PASSWORD?.length ?? 0) >= MIN_PASSWORD_LENGTH,
      next: safeNext(query.next),
      error: typeof query.error === 'string' ? query.error : null,
    },
  }
}
