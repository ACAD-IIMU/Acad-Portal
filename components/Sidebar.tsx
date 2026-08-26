// components/Sidebar.tsx
//
// Shared left nav. Self-determines the active item from the current URL
// (usePathname). Two behaviors:
//   - Mobile (below md breakpoint): hamburger toggle + slide-in drawer + backdrop.
//   - Desktop (md and up): collapsible — a toggle button shrinks it to an
//     icon-only rail. State persists across page loads via localStorage,
//     since Sidebar remounts fresh on every navigation (it's rendered inside
//     each page, not a shared layout.tsx).

'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

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
    href: '/sr-elections',
    label: 'SR Elections',
    icon: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M8 12.5l2.5 2.5L16 9" />
      </>
    ),
  },
  {
    href: '/planner',
    label: 'Term Planner',
    icon: (
      <>
        <rect x="3.5" y="4.5" width="17" height="15.5" rx="2" />
        <path d="M3.5 9.5h17M8 3v3M16 3v3M8.5 13h3M8.5 16.5h6" />
      </>
    ),
  },
];

const COLLAPSE_KEY = 'acad-sidebar-collapsed';

export default function Sidebar({ batchLabel }: { batchLabel?: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false); // mobile drawer
  const [collapsed, setCollapsed] = useState(false); // desktop rail
  const [hydrated, setHydrated] = useState(false);

  // Read persisted collapse state once on mount. Gated behind `hydrated` so
  // the server-rendered markup (always "expanded") matches the client's first
  // render, then updates right after — avoids a hydration mismatch warning.
  useEffect(() => {
    const stored = window.localStorage.getItem(COLLAPSE_KEY);
    if (stored === '1') setCollapsed(true);
    setHydrated(true);
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      return next;
    });
  }

  const showLabels = !hydrated || !collapsed;
  const railWidth = hydrated && collapsed ? 'md:w-[76px]' : 'md:w-[250px]';

  return (
    <>
      {/* Mobile menu button */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        className="md:hidden fixed top-4 left-4 z-50 w-9 h-9 rounded-lg border border-line bg-white shadow-sm flex items-center justify-center"
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Backdrop, mobile only */}
      {open && (
        <div onClick={() => setOpen(false)} className="md:hidden fixed inset-0 bg-black/45 z-40" />
      )}

      <aside
        className={`
          relative bg-gradient-to-b from-brand-950 to-brand-900 text-brand-50 flex flex-col
          p-5 w-[250px] ${railWidth} flex-shrink-0
          fixed top-0 left-0 h-screen z-50 transition-all duration-200
          md:sticky md:translate-x-0
          ${open ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* Desktop collapse toggle */}
        <button
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="hidden md:flex absolute -right-3 top-8 w-6 h-6 rounded-full bg-brand-900 border border-white/20 items-center justify-center text-white hover:bg-brand-800 transition"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            className={`transition-transform ${collapsed ? 'rotate-180' : ''}`}
          >
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>

        <div className={`flex items-center gap-2.5 pb-6 px-1 ${collapsed ? 'md:justify-center md:gap-0' : ''}`}>
          <Image
            src="/acad-logo.png"
            alt="ACAD"
            width={36}
            height={36}
            className="rounded-md flex-shrink-0"
          />
          {showLabels && (
            <div className="leading-tight">
              <div className="text-sm font-semibold text-white">ACAD Portal</div>
              <div className="text-[11px] text-brand-100/70">IIM Udaipur</div>
            </div>
          )}
        </div>

        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                title={collapsed ? item.label : undefined}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition ${
                  collapsed ? 'md:justify-center md:px-0' : ''
                } ${isActive ? 'bg-white/15 text-white' : 'text-brand-100/85 hover:bg-white/5 hover:text-white'}`}
              >
                <svg className="w-[18px] h-[18px] flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  {item.icon}
                </svg>
                <span className={collapsed ? 'md:hidden' : ''}>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {batchLabel && (
          <div
            className={`mt-auto p-3 rounded-lg bg-white/5 text-xs text-brand-100/80 leading-relaxed ${
              collapsed ? 'md:hidden' : ''
            }`}
          >
            <div className="font-semibold text-brand-50 text-[12.5px] mb-0.5">{batchLabel}</div>
            Student Portal
          </div>
        )}
      </aside>
    </>
  );
}
