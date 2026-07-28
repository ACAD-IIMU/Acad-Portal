'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

export default function UserMenu({
  name,
  regNo,
  batchLabel
}: {
  name: string;
  regNo?: string;
  batchLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape — standard menu behavior (User Control & Freedom).
  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  async function handleLogout() {
    setLoggingOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    // Hard navigation (not router.push) — forces a full reload so no stale
    // client state survives, and middleware re-evaluates the session fresh.
    window.location.assign('/login');
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2.5 rounded-full border border-line bg-white pl-1.5 pr-3 py-1.5 hover:border-brand-700 transition"
      >
        <span className="flex items-center justify-center w-8 h-8 rounded-full bg-brand-700 text-white text-xs font-semibold shrink-0">
          {initialsOf(name)}
        </span>
        <span className="text-sm font-semibold text-brand-950 leading-tight">{name}</span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 20 20"
          fill="none"
          className={`text-inkFaint transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="M5 7.5l5 5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-56 card p-1.5 z-20"
        >
          <div className="px-3 py-2.5 border-b border-line mb-1">
            <p className="text-sm font-semibold text-brand-950">{name}</p>
            {(regNo || batchLabel) && (
              <p className="text-xs text-inkFaint mt-0.5">
                {[regNo, batchLabel].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={handleLogout}
            disabled={loggingOut}
            className="w-full text-left px-3 py-2 rounded-lg text-sm font-semibold text-danger hover:bg-danger-100 transition disabled:opacity-60"
          >
            {loggingOut ? 'Logging out…' : 'Log out'}
          </button>
        </div>
      )}
    </div>
  );
}
