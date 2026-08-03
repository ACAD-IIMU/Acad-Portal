// components/Sidebar.tsx
//
// Shared left nav across every screen. Self-determines the active item from
// the current URL (usePathname) — no prop needed from each page for that.
// Handles mobile: hamburger toggle + slide-in drawer + backdrop, matching the
// V10 demo's mobile behavior.

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';

type NavItem = {
  href: string;
  label: string;
  icon: ReactNode;
};

const NAV_ITEMS: NavItem[] = [
  {
    href: '/home',
    label: 'Home',
    icon: <path d="M4 11.5 12 4l8 7.5M6 10v9h12v-9" />,
  },
  {
    href: '/eap',
    label: 'EAP Points',
    icon: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7v5l3.2 2" />
      </>
    ),
  },
  {
    href: '/sr',
    label: 'SR Elections',
    icon: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M8 12l2.5 2.5L16 9" />
      </>
    ),
  },
  {
    href: '/feedback',
    label: 'Feedback',
    icon: <path d="M21 11.5a8.5 8.5 0 0 1-12.4 7.6L4 20l1-4.4A8.5 8.5 0 1 1 21 11.5Z" />,
  },
  {
    href: '/manual',
    label: 'Programs Manual',
    icon: (
      <>
        <path d="M5 4.8C5 4 5.7 4 6.5 4H18a1 1 0 0 1 1 1v14.2a1 1 0 0 1-1 1H6.5c-.8 0-1.5 0-1.5-1" />
        <path d="M5 18.2c0-.8.7-1.2 1.5-1.2H19M8 8h8M8 11.3h8" />
      </>
    ),
  },
];

export default function Sidebar({ batchLabel }: { batchLabel?: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Mobile menu button — hidden on desktop (md:hidden) */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        className="md:hidden fixed top-4 left-4 z-50 w-9 h-9 rounded-lg border border-line bg-white shadow-sm flex items-center justify-center"
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Backdrop, mobile only, shown while drawer is open */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          className="md:hidden fixed inset-0 bg-black/45 z-40"
        />
      )}

      <aside
        className={`
          bg-gradient-to-b from-brand-950 to-brand-900 text-brand-50 flex flex-col
          p-5 w-[250px] flex-shrink-0
          fixed top-0 left-0 h-screen z-50 transition-transform duration-200
          md:sticky md:translate-x-0
          ${open ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        <div className="flex items-center gap-2.5 pb-6 px-1">
          <div className="w-9 h-9 rounded-md bg-white/10 flex items-center justify-center font-display font-bold text-sm flex-shrink-0">
            AC
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-white">ACAD Portal</div>
            <div className="text-[11px] text-brand-100/70">IIM Udaipur</div>
          </div>
        </div>

        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition ${
                  isActive ? 'bg-white/15 text-white' : 'text-brand-100/85 hover:bg-white/5 hover:text-white'
                }`}
              >
                <svg className="w-[18px] h-[18px] flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  {item.icon}
                </svg>
                {item.label}
              </Link>
            );
          })}
        </nav>

        {batchLabel && (
          <div className="mt-auto p-3 rounded-lg bg-white/5 text-xs text-brand-100/80 leading-relaxed">
            <div className="font-semibold text-brand-50 text-[12.5px] mb-0.5">{batchLabel}</div>
            Student Portal
          </div>
        )}
      </aside>
    </>
  );
}
