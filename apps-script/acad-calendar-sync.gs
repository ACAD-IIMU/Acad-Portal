/**
 * ACAD timetable → Google Calendar invites
 * ========================================
 * Lives inside acad@iimu.ac.in (script.google.com), NOT in the portal.
 *
 * Every 5 minutes it:
 *   1. asks the portal "what should change on the calendar?"
 *        (POST /api/calendar/invites/plan)
 *   2. creates / updates / removes those events on acad@'s calendar, with the students
 *      as guests — Google then shows each class on every guest's own calendar
 *   3. tells the portal what it did (POST /api/calendar/invites/ack)
 *
 * The portal decides WHEN to email students (only last-minute changes); this script
 * just passes that choice on to Google ("sendUpdates": "all" or "none").
 *
 * One-time setup (see apps-script/README.md for the click-by-click version):
 *   - Services (+) → add "Google Calendar API" (identifier: Calendar)
 *   - Project Settings → Script properties → add CALENDAR_SYNC_SECRET
 *   - Run setupOnce() and approve the permissions
 *
 * Everything here is safe to run again: creating an event that already exists turns
 * into an update, removing one that is already gone counts as done.
 */

var PORTAL_URL = 'https://acad-student-portal.vercel.app';
var CALENDAR_ID = 'primary';               // acad@'s own calendar
var TIME_BUDGET_MS = 4.5 * 60 * 1000;      // Apps Script stops runs at 6 minutes
var PAUSE_BETWEEN_CALLS_MS = 150;          // be gentle with Google's rate limits
var ALERT_EVERY_HOURS = 6;                 // don't email acad@ about the same problem more often

/** Run once by hand after pasting the script. Creates the 5-minute timer and shows a preview. */
function setupOnce() {
  getSecret_(); // stops here with a clear message if the secret is missing
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runCalendarSync') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runCalendarSync').timeBased().everyMinutes(5).create();
  Logger.log('Timer created: runCalendarSync will run every 5 minutes.');
  previewPlan();
}

/** Read-only: shows what the next run would do. Changes nothing. */
function previewPlan() {
  var preview = callPortal_('get', '/api/calendar/invites/plan');
  Logger.log(JSON.stringify(preview, null, 2));
  return preview;
}

/** The job the timer runs. */
function runCalendarSync() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return; // a previous run is still going — let it finish

  try {
    var plan = callPortal_('post', '/api/calendar/invites/plan', {});
    if (plan.paused) return;
    if (plan.held) {
      alertOnce_('held', 'ACAD calendar sync is on hold — needs a human',
        plan.reason + '\n\nNothing has been changed on anyone’s calendar.');
      return;
    }

    var started = Date.now();
    var results = [];
    for (var i = 0; i < plan.ops.length; i++) {
      if (Date.now() - started > TIME_BUDGET_MS) break; // the rest is picked up next run
      results.push(applyOp_(plan.ops[i]));
      Utilities.sleep(PAUSE_BETWEEN_CALLS_MS);
    }

    if (results.length > 0) {
      callPortal_('post', '/api/calendar/invites/ack', { results: results });
    }

    var failed = results.filter(function (r) { return !r.ok; });
    if (failed.length > 0) {
      alertOnce_('failed', 'ACAD calendar sync: ' + failed.length + ' change(s) failed',
        failed.slice(0, 10).map(function (r) { return r.op + ' ' + r.summary + ' — ' + r.error; }).join('\n') +
        '\n\nThey will be retried automatically every 5 minutes.');
    } else {
      PropertiesService.getScriptProperties().deleteProperty('ALERT_error');
    }
  } catch (e) {
    alertOnce_('error', 'ACAD calendar sync stopped with an error', String((e && e.stack) || e));
    throw e;
  } finally {
    lock.releaseLock();
  }
}

/** Carries out one create / update / delete and reports back. */
function applyOp_(op) {
  var result = {
    op: op.op, key: op.key, eventId: op.eventId, batchLabel: op.batchLabel, summary: op.summary,
    sendUpdates: op.sendUpdates, startAt: op.startAt, endAt: op.endAt, location: op.location,
    contentHash: op.contentHash, attendeeHash: op.attendeeHash, reason: op.reason,
    ok: false, error: null
  };
  var args = { sendUpdates: op.sendUpdates };

  try {
    if (op.op === 'create') {
      try {
        Calendar.Events.insert(op.resource, CALENDAR_ID, args);
      } catch (e) {
        if (!isAlreadyExists_(e)) throw e;
        // Same ID used before (e.g. a class that was cancelled and then put back):
        // bring the old event back to life with the new details.
        Calendar.Events.update(op.resource, CALENDAR_ID, op.eventId, args);
      }
    } else if (op.op === 'update') {
      try {
        Calendar.Events.update(op.resource, CALENDAR_ID, op.eventId, args);
      } catch (e) {
        if (!isNotFound_(e)) throw e;
        Calendar.Events.insert(op.resource, CALENDAR_ID, args); // someone deleted it by hand
      }
    } else if (op.op === 'delete') {
      try {
        removeEvent_(op.eventId, args);
      } catch (e) {
        if (!isNotFound_(e)) throw e; // already gone = done
      }
    } else {
      throw new Error('Unknown operation: ' + op.op);
    }
    result.ok = true;
  } catch (e) {
    result.error = String((e && e.message) || e).slice(0, 500);
  }
  return result;
}

// The advanced service names "delete" as "remove" (delete is a reserved word in JS).
function removeEvent_(eventId, args) {
  var fn = Calendar.Events.remove || Calendar.Events['delete'];
  return fn.call(Calendar.Events, CALENDAR_ID, eventId, args);
}

function errorCode_(e) {
  return (e && e.details && e.details.code) || null;
}

function isAlreadyExists_(e) {
  return errorCode_(e) === 409 || /already exists|duplicate/i.test(String(e && e.message));
}

function isNotFound_(e) {
  var code = errorCode_(e);
  return code === 404 || code === 410 || /not found|has been deleted|\b404\b|\b410\b/i.test(String(e && e.message));
}

function callPortal_(method, path, body) {
  var options = {
    method: method,
    headers: { Authorization: 'Bearer ' + getSecret_() },
    muteHttpExceptions: true
  };
  if (body !== undefined) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(body);
  }
  var res = UrlFetchApp.fetch(PORTAL_URL + path, options);
  var code = res.getResponseCode();
  var text = res.getContentText();
  if (code !== 200) {
    throw new Error('Portal ' + path + ' answered ' + code + ': ' + text.slice(0, 500));
  }
  return JSON.parse(text);
}

function getSecret_() {
  var secret = PropertiesService.getScriptProperties().getProperty('CALENDAR_SYNC_SECRET');
  if (!secret) {
    throw new Error('Missing script property CALENDAR_SYNC_SECRET (Project Settings → Script properties).');
  }
  return secret;
}

/** Emails acad@ about a problem, at most once every ALERT_EVERY_HOURS per kind. */
function alertOnce_(kind, subject, body) {
  var props = PropertiesService.getScriptProperties();
  var key = 'ALERT_' + kind;
  var last = Number(props.getProperty(key) || 0);
  if (Date.now() - last < ALERT_EVERY_HOURS * 60 * 60 * 1000) return;
  props.setProperty(key, String(Date.now()));
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(), subject, body);
}
