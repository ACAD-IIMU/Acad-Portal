'use client';

import Image from 'next/image';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        // Calendar scope requested upfront at login (not incremental) — keeps the
        // "Add to Google Calendar" button on Home a single click, no second consent screen.
        scopes: 'openid email profile https://www.googleapis.com/auth/calendar.events',
        queryParams: {
          access_type: 'offline', // needed to receive a refresh_token, not just an access_token
          prompt: 'consent',      // forces Google to re-issue the refresh_token every sign-in
          hd: 'iimu.ac.in'        // hints Google's account chooser to the right domain (UX only, not a security boundary)
        }
      }
    });
    if (signInError) {
      setError(signInError.message);
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="card w-full max-w-sm p-10 flex flex-col items-center text-center">
        <Image
          src="/iimu-logo.png"
          alt="IIM Udaipur"
          width={56}
          height={56}
          className="mb-6 object-contain"
        />
        <h1 className="text-xl mb-1">ACAD Student Portal</h1>
        <p className="text-inkFaint text-sm mb-8">Sign in with your IIMU account</p>

        <button
          onClick={signIn}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 rounded-lg border border-line py-3 px-4 font-semibold text-sm hover:border-brand-700 transition disabled:opacity-60"
        >
          <GoogleIcon />
          {loading ? 'Redirecting…' : 'Continue with Google'}
        </button>

        {error === null && new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '').get('error') === 'domain' && (
          <p className="text-danger text-xs mt-4">
            Please sign in with your @iimu.ac.in account.
          </p>
        )}
        {error && <p className="text-danger text-xs mt-4">{error}</p>}

        <p className="text-inkFaint text-[11px] mt-8">
          Access is restricted to @iimu.ac.in accounts.
        </p>
      </div>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.3 35.4 26.8 36 24 36c-5.3 0-9.6-3.4-11.2-8.1l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.7l6.3 5.3C40.9 36.5 44 30.9 44 24c0-1.3-.1-2.7-.4-3.5z"/>
    </svg>
  );
}
