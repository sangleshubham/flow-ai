// Sign in with each visitor’s own ChatGPT account (ADR 0055).
import type { GetServerSideProps } from 'next'
import Head from 'next/head'

import { MIN_PASSWORD_LENGTH, safeNext } from '../security/login'
import { getIllusServer } from '../server/llm'

interface Props {
  chatgpt: boolean
  password: boolean
  next: string
  error: string | null
  open: boolean
  sourceUrl: string
}

const ERRORS: Record<string, string> = {
  password: 'Wrong password.',
  busy: 'Too many attempts. Wait a minute and try again.',
  config: 'Login is not configured on this server. See docs/deploy.md.',
}

export default function Login({
  chatgpt,
  password,
  next,
  error,
  open,
  sourceUrl,
}: Props) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white p-6 text-gray-900">
      <Head>
        <title>Sign in</title>
        <meta name="robots" content="noindex" />
      </Head>
      <div className="w-full max-w-xs space-y-4">
        <h1 className="text-xl font-semibold">Sign in</h1>
        {open && (
          <p className="text-sm">
            Sign in with your ChatGPT account. The reader uses your own plan.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {ERRORS[error] ?? 'Sign-in failed.'}
          </p>
        )}
        {chatgpt && (
          <a
            href={`/auth/chatgpt/start?next=${encodeURIComponent(next)}`}
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
        <footer className="text-sm">
          <a href={sourceUrl} rel="noopener noreferrer">
            Source code
          </a>
        </footer>
      </div>
    </main>
  )
}

export const getServerSideProps: GetServerSideProps<Props> = async ({
  query,
  res,
}) => {
  res.setHeader('Cache-Control', 'no-store')
  const env = process.env
  const secret = (env.ILLUS_SESSION_SECRET?.length ?? 0) >= 32
  let owner = !!env.ILLUS_ALLOWED_ACCOUNT_ID?.trim()
  if (secret && !owner) {
    try {
      owner = !!(await (await getIllusServer()).ownerSub())
    } catch {
      /* Show configuration help below. */
    }
  }
  const sourceUrl =
    env.ILLUS_SOURCE_URL || 'https://github.com/sangleshubham/flow-ai'
  return {
    props: {
      open: (env.ILLUS_ACCESS ?? 'open') === 'open',
      sourceUrl: /^https?:\/\//.test(sourceUrl)
        ? sourceUrl
        : 'https://github.com/sangleshubham/flow-ai',
      chatgpt: secret && !!env.ILLUS_TOKEN_ENC_KEY,
      password:
        secret &&
        owner &&
        (env.ILLUS_LOGIN_PASSWORD?.length ?? 0) >= MIN_PASSWORD_LENGTH,
      next: safeNext(query.next),
      error: typeof query.error === 'string' ? query.error : null,
    },
  }
}
