// components/CourseWorkshopsRow.tsx
//
// Redress opens a pre-filled Gmail compose (web on desktop, the Gmail app on
// mobile) rather than an in-app form — see app/eap/page.tsx for why. That
// means there's no server round-trip and no way to know whether a student
// actually sent the email or just closed the tab, so this component has no
// "already requested" state anymore: the button is always just a link.

'use client';

import { useState } from 'react';

type Subject = {
  name: string;
  status: 'P' | 'A' | 'L' | 'S' | 'S_L' | 'NA' | null; // null = mandated but no attendance data yet
};

const STATUS_LABEL: Record<NonNullable<Subject['status']>, string> = {
  P: 'Present',
  A: 'Absent',
  L: 'Late',
  S: 'Smart Casuals',
  S_L: 'S + L (Absent)', // nets to zero credit, scored as Absent — shown with the original "S + L" wording
  NA: 'Not Applicable',
};

// P green, A red, NA gray, everything else (Late/Smart Casuals/S+L) yellow.
const STATUS_STYLE: Record<NonNullable<Subject['status']>, string> = {
  P: 'bg-[#e2f2e8] text-[#1e7a4c]',
  A: 'bg-danger-100 text-danger',
  NA: 'bg-line text-inkFaint',
  L: 'bg-gold-100 text-gold-600',
  S: 'bg-gold-100 text-gold-600',
  S_L: 'bg-gold-100 text-gold-600',
};

// Not mailto: — mailto: defers to whatever mail client the OS/browser has
// registered as default (Outlook on some desktops, an arbitrary app picker
// on mobile), which we can't control per-device. Instead we target Gmail
// directly: the web compose UI on desktop, and the Gmail app's own deep-link
// scheme on mobile — both using whichever Google account is already signed
// in, which for these students is their @iimu.ac.in account from portal login.
function buildRedressLinks(subjectName: string, regNo: string, term: string, batchLabel: string) {
  const year = batchLabel.match(/\d{4}/)?.[0] ?? '';
  const to = year ? `acad.${year}@iimu.ac.in` : '';

  const subject = `EAP Redress — ${term} — ${subjectName} — ${regNo}`;

  const body = [
    'Hi ACAD,',
    '',
    "I'd like to request a redress for the Course Workshop session below.",
    '',
    `Reg. No.: ${regNo}`,
    `Subject: ${subjectName}`,
    `Term: ${term}`,
    '',
    'Reason:',
    '[please describe why you were marked absent]',
    '',
    '',
    'Please attach your proof (screenshot, email, etc.) to this email before sending — a request without proof attached will not be considered.',
    '',
    'Thanks',
  ].join('\n');

  // No fs=1 (full-screen compose) — that mode hides Gmail's normal chrome,
  // including the account-switcher avatar, so students couldn't tell which
  // signed-in account they were about to send from.
  const web = `https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  // googlegmail:// is the Gmail app's compose deep-link scheme on iOS only —
  // the Android Gmail app doesn't register it at all.
  const iosApp = `googlegmail:///co?to=${encodeURIComponent(to)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  // Android: Chrome's intent: syntax, targeting the Gmail package explicitly
  // via a mailto payload. No "//" after "intent:" — mailto: URIs have no
  // authority component (mailto:addr, not mailto://addr), and Chrome carries
  // whatever's there straight into the reconstructed mailto: URI; including
  // "//" produced "mailto://addr", which Gmail parsed as "//addr" literally.
  // Chrome resolves the "app not installed" fallback natively via
  // S.browser_fallback_url — no timeout guessing needed.
  const androidIntent = `intent:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}#Intent;scheme=mailto;package=com.google.android.gm;S.browser_fallback_url=${encodeURIComponent(web)};end`;

  return { web, iosApp, androidIntent };
}

// Deep-links into the Gmail app on mobile. Android and iOS need different
// mechanisms (see buildRedressLinks); Android's intent:// URLs fall back to
// web automatically, so only iOS needs the manual timeout/blur fallback
// trick (falls back to Gmail web in a new tab if the app isn't installed,
// detected by whether the page is still focused shortly after — a real app
// switch blurs the tab before the timer fires).
function goToRedress(links: { web: string; iosApp: string; androidIntent: string }) {
  const ua = navigator.userAgent;

  if (/Android/i.test(ua)) {
    window.location.href = links.androidIntent;
    return;
  }

  if (/iPhone|iPad|iPod/i.test(ua)) {
    const fallback = setTimeout(() => window.open(links.web, '_blank'), 1500);
    window.addEventListener('blur', () => clearTimeout(fallback), { once: true });
    window.location.href = links.iosApp;
    return;
  }

  window.open(links.web, '_blank');
}

export default function CourseWorkshopsRow({
  value,
  max,
  isNA,
  regNo,
  term,
  batchLabel,
  studentEmail,
  subjects,
}: {
  value: number | null;
  max: number;
  isNA: boolean;
  regNo: string;
  term: string;
  batchLabel: string;
  studentEmail: string;
  subjects: Subject[];
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<{
    subjectName: string;
    links: { web: string; iosApp: string; androidIntent: string };
  } | null>(null);

  const isPendingScore = value === null || value === undefined;

  // Exchange-program students aren't doing Course Workshops this term at
  // all — a flat, non-expandable N/A row, not a Pending state implying
  // data is still coming.
  if (isNA) {
    return (
      <tr className="border-b border-line">
        <td className="py-2.5">Course Workshops</td>
        <td className="py-2.5 text-right">
          <span className="text-xs italic text-inkFaint">N/A — Exchange Program</span>
        </td>
      </tr>
    );
  }

  return (
    <>
      <tr
        className="border-b border-line cursor-pointer hover:bg-brand-50/40"
        onClick={() => setOpen((o) => !o)}
      >
        <td className="py-2.5">
          <span className="inline-flex items-center gap-2">
            <span
              className={`inline-flex items-center justify-center w-5 h-5 rounded-full border border-line text-brand-700 flex-shrink-0 transition-transform ${
                open ? 'rotate-90' : ''
              }`}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </span>
            Course Workshops
          </span>
        </td>
        <td className="py-2.5 text-right font-mono">
          {isPendingScore ? (
            <span className="text-xs font-semibold text-gold-600 bg-gold-100 px-2.5 py-1 rounded-full whitespace-nowrap">
              Pending
            </span>
          ) : (
            <>
              {value}
              <span className="font-sans text-inkFaint text-xs ml-0.5">/{max}</span>
            </>
          )}
        </td>
      </tr>

      {open && (
        <tr className="border-b border-line">
          <td colSpan={2} className="p-0">
            <div className="bg-brand-50/50 px-3 py-3.5 pl-8">
              <div className="flex flex-col gap-0">
                {subjects.map((s) => {
                  const isAbsent = s.status === 'A' || s.status === 'S_L';
                  return (
                    <div
                      key={s.name}
                      className="flex items-center justify-between gap-3 py-2 border-b border-dashed border-line last:border-none text-sm"
                    >
                      <span className="flex-1 min-w-0">{s.name}</span>
                      <div className="flex items-center gap-2.5 flex-shrink-0">
                        {s.status === null ? (
                          <span className="text-xs font-semibold text-gold-600 bg-gold-100 px-2.5 py-1 rounded-full whitespace-nowrap">
                            Pending
                          </span>
                        ) : (
                          <span
                            className={`text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${STATUS_STYLE[s.status]}`}
                          >
                            {STATUS_LABEL[s.status]}
                          </span>
                        )}
                        {isAbsent && (() => {
                          const links = buildRedressLinks(s.name, regNo, term, batchLabel);
                          return (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirming({ subjectName: s.name, links });
                              }}
                              className="text-xs border border-line rounded-full px-2.5 py-1 hover:border-danger hover:text-danger transition whitespace-nowrap"
                            >
                              Redress
                            </button>
                          );
                        })()}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </td>
        </tr>
      )}

      {confirming && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-card p-6 w-full max-w-sm">
            <h3 className="text-lg mb-1">Send redress request?</h3>
            <p className="text-sm text-inkSoft mb-5">
              This will open a mail from <span className="font-semibold">{studentEmail}</span> with
              a pre-filled redress request for{' '}
              <span className="font-semibold">{confirming.subjectName}</span>.
            </p>
            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirming(null)}
                className="text-sm font-semibold px-4 py-2 rounded-full border border-line hover:bg-cream transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  goToRedress(confirming.links);
                  setConfirming(null);
                }}
                className="text-sm font-semibold px-4 py-2 rounded-full bg-brand-700 text-white hover:bg-brand-800 transition"
              >
                Proceed
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
