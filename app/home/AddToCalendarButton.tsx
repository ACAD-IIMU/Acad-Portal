'use client';

import { useState } from 'react';

// Calls the already-existing POST /api/calendar/push route, which calls
// pushScheduleToCalendar() in lib/googleCalendar.ts. Both of those were already built
// and working — this component is the missing piece that was never wired up to a
// visible button anywhere in the UI. Calendar write scope is requested upfront at
// login (see app/login/page.tsx), not incrementally, so this can call the route
// directly without triggering its own separate OAuth consent screen.
export default function AddToCalendarButton() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleClick() {
    setStatus('loading');
    setErrorMessage(null);
    try {
      const res = await fetch('/api/calendar/push', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) {
        throw new Error(data?.error ?? 'Something went wrong');
      }
      setStatus('success');
    } catch (err: any) {
      setStatus('error');
      setErrorMessage(err?.message ?? null);
    }
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button
        onClick={handleClick}
        disabled={status === 'loading'}
        className="flex items-center gap-1.5 text-sm font-semibold text-white bg-brand-700 rounded-full px-4 py-2 shadow-sm hover:bg-brand-800 transition disabled:opacity-50 disabled:pointer-events-none"
      >
        📅 {status === 'loading' ? 'Adding…' : 'Add to Google Calendar'}
      </button>
      {status === 'success' && (
        <span id="gcal-status" className="text-xs font-semibold text-brand-700">
          Added to your calendar ✓
        </span>
      )}
      {status === 'error' && (
        <span id="gcal-status" className="text-xs font-semibold text-danger">
          Couldn&apos;t add to calendar{errorMessage ? ` — ${errorMessage}` : ''}. Try again in a moment.
        </span>
      )}
    </div>
  );
}
