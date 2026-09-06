import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth-context'
import './login.css'

type Mode = 'signin' | 'signup'

function GoogleIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  )
}

export default function Login() {
  const { user } = useAuth()
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Once signed in, hand off to the dashboard (the Cramduck hub at the
  // origin root) — it reads the same Supabase session from localStorage.
  useEffect(() => {
    if (user) window.location.href = `${window.location.origin}/`
  }, [user])

  if (user) return null

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      if (mode === 'signup') {
        const { data, error: err } = await supabase.auth.signUp({ email, password })
        if (err) throw err
        if (data.session === null) setNotice('check your inbox to confirm, then sign in')
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password })
        if (err) throw err
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const googleSignIn = async () => {
    setError(null)
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}${window.location.pathname}` },
    })
    if (err) setError(err.message)
  }

  return (
    <div className="cd-login">
      <div className="cd-wrap">
        <div className="cd-brand">
          Cram<span>duck</span>
          <small>Study system · SAT + AP</small>
        </div>

        <div className="cd-card">
          <div className="cd-tabs">
            <button className={mode === 'signin' ? 'on' : ''} onClick={() => { setMode('signin'); setError(null); setNotice(null) }}>
              Sign in
            </button>
            <button className={mode === 'signup' ? 'on' : ''} onClick={() => { setMode('signup'); setError(null); setNotice(null) }}>
              Sign up
            </button>
          </div>

          <form onSubmit={submit}>
            <label className="cd-field">
              <span className="lbl">Email</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </label>
            <label className="cd-field">
              <span className="lbl">Password</span>
              <input
                type="password"
                required
                minLength={mode === 'signup' ? 8 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'signup' ? 'at least 8 characters' : 'your password'}
              />
            </label>
            <button type="submit" disabled={busy} className="cd-btn pri">
              {busy ? 'one moment…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <div className="cd-or">or</div>

          <button onClick={googleSignIn} className="cd-btn sec">
            <GoogleIcon />
            Continue with Google
          </button>
        </div>

        {notice && <div className="cd-note">{notice}</div>}
        {error && <div className="cd-note err">{error}</div>}

        <p className="cd-foot">your practice results live on your account</p>
      </div>
    </div>
  )
}
