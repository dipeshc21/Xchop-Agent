'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/browser';
import { isSupabaseConfigured } from '@/lib/config';
import { Button } from '@/components/ui/button';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const configured = isSupabaseConfigured();

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('error') === 'expired') {
      setMessage('That sign-in link has expired or could not be verified. Sign in with your email and password below.');
    }
  }, []);

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configured || busy) return;
    setMessage('');
    setBusy(true);
    try {
      const { error } = await supabaseBrowser().auth.signInWithPassword({
        email: email.trim(), password,
      });
      if (error) {
        setMessage(error.code === 'email_not_confirmed'
          ? 'Your email has not been confirmed. Ask the workspace owner to confirm your account in Supabase.'
          : error.status === 429
            ? 'Too many sign-in attempts. Please wait a few minutes and try again.'
            : error.code === 'invalid_credentials'
              ? 'The email or password is incorrect. Use the account created in Supabase Authentication.'
              : 'Sign-in could not complete. Check your Supabase connection on the setup page.');
      } else {
        window.location.assign('/');
      }
    } catch {
      setMessage('We could not reach Supabase. Check your connection and the setup page, then try again.');
    } finally {
      setBusy(false);
    }
  }

  return <main className="login">
    <form className="panel login-panel" onSubmit={signIn}>
      <div className="brand-mark">x.</div>
      <h1>Welcome to your growth workspace.</h1>
      <p>Sign in to XHTMLChop Growth Agent.</p>
      {!configured && <div className="info-box" role="status" style={{ marginBottom: 20 }}>
        Connect your Supabase project before signing in. <Link href="/setup" className="text-link">Open setup →</Link>
      </div>}
      <label>Email<input type="email" autoComplete="username" required maxLength={254} disabled={!configured || busy} value={email} onChange={event => setEmail(event.target.value)} /></label>
      <label>Password<input type="password" autoComplete="current-password" required disabled={!configured || busy} value={password} onChange={event => setPassword(event.target.value)} /></label>
      <Button disabled={!configured || busy}>{busy ? 'Signing in…' : 'Sign in →'}</Button>
      <p role="status" aria-live="polite">{message}</p>
      <small>Your workspace owner creates your account in Supabase. Public registration is disabled.</small>
      <p style={{ marginBottom: 0 }}><Link className="text-link" href="/setup">Connection & account setup →</Link></p>
    </form>
  </main>;
}
