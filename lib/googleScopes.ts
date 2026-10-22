// Google permissions the portal asks for at sign-in. Kept in one tiny file (no imports)
// so the login page (a client component) and the server can share it.
//
//   calendar.events        — legacy: the old "Add to Google Calendar" copy and its cleanup
//   calendar.calendarlist  — lets the portal add the student's ACAD section calendars to
//                            their own Google Calendar list (and nothing else: it cannot
//                            read or change the student's own events with this one)

export const CALENDAR_EVENTS_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
export const CALENDARLIST_SCOPE = 'https://www.googleapis.com/auth/calendar.calendarlist';

export const LOGIN_SCOPES = ['openid', 'email', 'profile', CALENDAR_EVENTS_SCOPE, CALENDARLIST_SCOPE].join(' ');

// What gets stored in google_tokens.scope for a sign-in that asked for LOGIN_SCOPES.
export const STORED_SCOPES = [CALENDAR_EVENTS_SCOPE, CALENDARLIST_SCOPE].join(' ');
