'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { LOGIN_SCOPES } from '@/lib/googleScopes';

// Home card: "Class calendar & alerts".
//
// 1. Class calendars — ACAD's section calendars in the student's own Google Calendar.
//    Usually added automatically (at sign-in, or in the background every 5 minutes); this
//    card shows that it worked, or gives a one-tap way to finish it.
// 2. Class alerts — phone / laptop notifications when a class in the next 48 hours is
//    added, moved, changes room or is cancelled. Needs one tap per device, because the
//    browser has to ask the student for permission.

type FeedStatus = { feedKey: string; title: string; ready: boolean; added: boolean; addUrl: string | null };
type CalendarStatus = {
  enabled: boolean;
  feeds: FeedStatus[];
  allAdded: boolean;
  needsPermission: boolean;
  confirmed: boolean;
};

type AlertState = 'checking' | 'unsupported' | 'ios-install' | 'blocked' | 'off' | 'working' | 'on' | 'error';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isAndroid(): boolean {
  return /android/i.test(navigator.userAgent);
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
}

export default function ClassCalendarCard() {
  const [calendar, setCalendar] = useState<CalendarStatus | null>(null);
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [platform, setPlatform] = useState<'android' | 'ios' | 'other'>('other');
  const [alerts, setAlerts] = useState<AlertState>('checking');
  const [alertError, setAlertError] = useState<string | null>(null);

  // ---------- class calendars ----------

  useEffect(() => {
    setPlatform(isAndroid() ? 'android' : isIos() ? 'ios' : 'other');
  }, []);

  async function confirmSeen() {
    setCalendarBusy(true);
    setCalendarError(null);
    try {
      const res = await fetch('/api/calendar/feeds/me', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm' })
      });
      const data = await res.json().catch(() => ({}));
      if (data.status) setCalendar(data.status as CalendarStatus);
      if (!res.ok) throw new Error(data?.error ?? 'Something went wrong');
    } catch (err: any) {
      setCalendarError(err?.message ?? 'Something went wrong');
    }
    setCalendarBusy(false);
  }

  useEffect(() => {
    let active = true;
    fetch('/api/calendar/feeds/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (active && data && !data.error) setCalendar(data as CalendarStatus);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  async function grantPermission() {
    // Same sign-in as the login page — it now also asks for the calendar-list permission,
    // and the sign-in callback adds the calendars straight away.
    setCalendarBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes: LOGIN_SCOPES,
        skipBrowserRedirect: true,
        queryParams: { access_type: 'offline', prompt: 'consent', hd: 'iimu.ac.in' }
      }
    });
    if (error || !data?.url) {
      setCalendarBusy(false);
      setCalendarError(error?.message ?? 'Could not open Google sign-in');
      return;
    }
    window.location.assign(data.url);
  }

  async function addCalendars() {
    setCalendarBusy(true);
    setCalendarError(null);
    try {
      const res = await fetch('/api/calendar/feeds/me', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? 'Something went wrong');
      if (data.status) setCalendar(data.status as CalendarStatus);
      if (data.needsPermission) {
        await grantPermission();
        return;
      }
    } catch (err: any) {
      setCalendarError(err?.message ?? 'Something went wrong');
    }
    setCalendarBusy(false);
  }

  // ---------- class alerts ----------

  const refreshAlerts = useCallback(async () => {
    if (typeof window === 'undefined') return;
    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    if (!supported || !VAPID_PUBLIC_KEY) {
      setAlerts(isIos() && !isStandalone() ? 'ios-install' : 'unsupported');
      return;
    }
    if (Notification.permission === 'denied') {
      setAlerts('blocked');
      return;
    }
    try {
      const reg = await navigator.serviceWorker.getRegistration('/');
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      setAlerts(sub ? 'on' : 'off');
    } catch {
      setAlerts('off');
    }
  }, []);

  useEffect(() => {
    refreshAlerts();
  }, [refreshAlerts]);

  async function turnOnAlerts() {
    setAlerts('working');
    setAlertError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setAlerts(permission === 'denied' ? 'blocked' : 'off');
        return;
      }
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource
        }));
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON() })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? 'Could not turn on alerts');
      setAlerts('on');
    } catch (err: any) {
      setAlertError(err?.message ?? 'Could not turn on alerts');
      setAlerts('error');
    }
  }

  async function turnOffAlerts() {
    setAlerts('working');
    try {
      const reg = await navigator.serviceWorker.getRegistration('/');
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint })
        }).catch(() => {});
        await sub.unsubscribe();
      }
    } finally {
      refreshAlerts();
    }
  }

  // ---------- view ----------

  const readyFeeds = calendar?.feeds.filter((f) => f.ready) ?? [];
  const missing = readyFeeds.filter((f) => !f.added);
  const showCalendar = !!calendar?.enabled && readyFeeds.length > 0;

  return (
    <div className="card p-5">
      <h2 className="text-sm mb-3">Class calendar &amp; alerts</h2>

      {showCalendar && (
        <div className="mb-4">
          {calendar!.allAdded && calendar!.confirmed ? (
            <p className="text-sm text-ink">
              <span className="font-semibold text-brand-700">✓ In your Google Calendar.</span>{' '}
              <span className="text-inkSoft">
                {readyFeeds.length} ACAD {readyFeeds.length === 1 ? 'calendar updates' : 'calendars update'} by themselves
                when the timetable changes, with a reminder 15 minutes before each class.
              </span>
            </p>
          ) : calendar!.allAdded ? (
            <>
              <p className="text-sm text-ink mb-2">
                <span className="font-semibold text-brand-700">✓ Added to your Google account.</span>{' '}
                <span className="text-inkSoft">One last step so they show on your phone:</span>
              </p>
              <PhoneSteps platform={platform} titles={readyFeeds.map((f) => f.title)} />
              <button
                onClick={confirmSeen}
                disabled={calendarBusy}
                className="w-full mt-3 text-sm font-semibold text-white bg-brand-700 rounded-full px-4 py-2 shadow-sm hover:bg-brand-800 transition disabled:opacity-50"
              >
                {calendarBusy ? 'Saving…' : '✓ I can see my ACAD classes on my phone'}
              </button>
              <p className="text-[11px] text-inkFaint mt-1.5">
                Until you tap this, you keep your old class invites too, so you never miss a class.
              </p>
              {calendarError && <p className="text-danger text-xs mt-2">{calendarError}</p>}
            </>
          ) : (
            <>
              <p className="text-sm text-inkSoft mb-2.5">
                Get every class in your Google Calendar — it updates by itself when the timetable changes. No
                invites, nothing to accept.
              </p>
              <button
                onClick={calendar!.needsPermission ? grantPermission : addCalendars}
                disabled={calendarBusy}
                className="w-full text-sm font-semibold text-white bg-brand-700 rounded-full px-4 py-2 shadow-sm hover:bg-brand-800 transition disabled:opacity-50"
              >
                {calendarBusy
                  ? 'Adding…'
                  : calendar!.needsPermission
                    ? '📅 Allow & add my class calendars'
                    : `📅 Add my class calendars (${missing.length})`}
              </button>
              {calendar!.needsPermission && (
                <p className="text-[11px] text-inkFaint mt-1.5">
                  Google will ask once to let the portal add calendars to your list.
                </p>
              )}
              {missing.length > 0 && (
                <details className="mt-2">
                  <summary className="text-xs text-inkFaint cursor-pointer">Or add them one by one</summary>
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {missing.map((f) => (
                      <li key={f.feedKey}>
                        <a
                          href={f.addUrl ?? '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-semibold text-brand-900 hover:text-brand-700"
                        >
                          {f.title} ↗
                        </a>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {calendarError && <p className="text-danger text-xs mt-2">{calendarError}</p>}
            </>
          )}
        </div>
      )}

      <div className={showCalendar ? 'border-t border-line pt-3.5' : ''}>
        {alerts === 'on' && (
          <p className="text-sm">
            <span className="font-semibold text-brand-700">✓ Class alerts are on for this device.</span>{' '}
            <span className="text-inkSoft">You’ll be notified if a class in the next 48 hours moves or is cancelled.</span>{' '}
            <button onClick={turnOffAlerts} className="text-xs text-inkFaint underline">
              Turn off
            </button>
          </p>
        )}
        {(alerts === 'off' || alerts === 'error' || alerts === 'working') && (
          <>
            <p className="text-sm text-inkSoft mb-2.5">
              Get a notification on this device if a class in the next 48 hours is moved, changes room or is
              cancelled — only for your own classes.
            </p>
            <button
              onClick={turnOnAlerts}
              disabled={alerts === 'working'}
              className="w-full text-sm font-semibold text-brand-900 border border-line rounded-full px-4 py-2 hover:border-brand-700 hover:bg-brand-50 transition disabled:opacity-50"
            >
              🔔 {alerts === 'working' ? 'Turning on…' : 'Turn on class alerts'}
            </button>
            {alertError && <p className="text-danger text-xs mt-2">{alertError}</p>}
          </>
        )}
        {alerts === 'ios-install' && (
          <p className="text-sm text-inkSoft">
            🔔 <span className="font-semibold text-ink">Class alerts on iPhone:</span> tap Share →{' '}
            <span className="font-semibold">Add to Home Screen</span>, open ACAD from your home screen, then turn on
            alerts here.
          </p>
        )}
        {alerts === 'blocked' && (
          <p className="text-sm text-inkSoft">
            🔔 Notifications are blocked for this site. Allow them in your browser’s site settings to get class alerts.
          </p>
        )}
        {alerts === 'unsupported' && (
          <p className="text-xs text-inkFaint">Class alerts aren’t available in this browser.</p>
        )}
      </div>
    </div>
  );
}

// How to make the ACAD calendars appear in the phone's calendar app. Android's Google Calendar
// app does not sync a newly added calendar until "Sync" is turned on for it — that is the
// single most common reason a student "can't see" their classes.
function PhoneSteps({ platform, titles }: { platform: 'android' | 'ios' | 'other'; titles: string[] }) {
  const android = (
    <ol className="list-decimal ml-4 text-xs text-inkSoft flex flex-col gap-1">
      <li>
        Open the <span className="font-semibold text-ink">Google Calendar</span> app → tap{' '}
        <span className="font-semibold text-ink">☰</span> (top left) → <span className="font-semibold text-ink">Refresh</span>.
      </li>
      <li>
        Tap <span className="font-semibold text-ink">☰</span> → <span className="font-semibold text-ink">Settings</span> → under
        your <span className="font-semibold text-ink">@iimu.ac.in</span> account, tap{' '}
        <span className="font-semibold text-ink">Show more</span> if needed.
      </li>
      <li>
        Tap each calendar starting with <span className="font-semibold text-ink">ACAD ·</span> and turn{' '}
        <span className="font-semibold text-ink">Sync</span> on ({titles.length}{' '}
        {titles.length === 1 ? 'calendar' : 'calendars'}).
      </li>
      <li>Go back to the calendar — your classes appear within a minute.</li>
    </ol>
  );
  const ios = (
    <ul className="list-disc ml-4 text-xs text-inkSoft flex flex-col gap-1">
      <li>
        <span className="font-semibold text-ink">Google Calendar app:</span> they show by themselves — pull down to refresh.
      </li>
      <li>
        <span className="font-semibold text-ink">Apple Calendar app:</span> open{' '}
        <a
          href="https://calendar.google.com/calendar/syncselect"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-brand-900 underline"
        >
          calendar.google.com/calendar/syncselect
        </a>
        , tick every <span className="font-semibold text-ink">ACAD ·</span> calendar and Save.
      </li>
    </ul>
  );
  if (platform === 'android') return android;
  if (platform === 'ios') return ios;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-inkSoft">
        They already show on Google Calendar on this computer. On your phone:
      </p>
      <p className="text-xs font-semibold text-ink">Android</p>
      {android}
      <p className="text-xs font-semibold text-ink">iPhone</p>
      {ios}
    </div>
  );
}
