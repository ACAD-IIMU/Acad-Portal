'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  // Starts true so we never flash the "Continue with Google" button at someone
  // who's actually already signed in (see the two effects below).
  const [checkingSession, setCheckingSession] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Case 1: this /login document is still live (e.g. the user pressed Back and
  // landed here) but they already hold a valid session. Bounce them forward to
  // Home instead of showing a stale sign-in screen.
  useEffect(() => {
    let active = true;
    const supabase = createClient();
    const hasErrorParam = new URLSearchParams(window.location.search).has('error');
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active) return;
      // Defense-in-depth: if /auth/callback sent us here with an error, show it —
      // even if a session happens to still be active — rather than silently
      // bouncing to Home and hiding whatever went wrong.
      if (session && !hasErrorParam) {
        router.replace('/home');
      } else {
        setCheckingSession(false);
      }
    });
    return () => {
      active = false;
    };
  }, [router]);

  // Case 2: the browser restores this page from the back/forward cache (bfcache)
  // after a Back press — a pure client-side restore with no network request, so
  // the effect above never gets a chance to re-run. `pageshow` with
  // `event.persisted` is the standard signal for that; forcing a reload makes it
  // hit the server again, which re-runs the check above with fresh state.
  useEffect(() => {
    function handlePageShow(event: PageTransitionEvent) {
      if (event.persisted) {
        window.location.reload();
      }
    }
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, []);

  async function signIn() {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { data, error: signInError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        // Calendar scope requested upfront at login (not incremental) — keeps the
        // "Add to Google Calendar" button on Home a single click, no second consent screen.
        scopes: 'openid email profile https://www.googleapis.com/auth/calendar.events',
        // We navigate ourselves (below) instead of letting supabase-js do
        // `location.href =`, so we can use `location.replace()` — that swaps this
        // /login entry out for Google's consent page in browser history instead
        // of stacking a new entry on top of it. One less hop for the back
        // button to walk through after landing on Home.
        skipBrowserRedirect: true,
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
      return;
    }
    if (data?.url) {
      window.location.replace(data.url);
    }
  }

  if (checkingSession) {
    // Deliberately blank/minimal — this resolves in one client-side check
    // against local session state, so it's on screen for a beat at most.
    return <main className="min-h-screen" />;
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
