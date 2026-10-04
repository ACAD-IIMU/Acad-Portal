import { NextResponse } from 'next/server';

// Retired. This route used to copy a student's whole schedule into their own Google
// Calendar (pushScheduleToCalendar in lib/googleCalendar.ts). That copy never updated
// when the timetable changed and never removed cancelled classes, which is how students
// ended up missing classes.
//
// Replacement: classes are sent as calendar invites from acad@iimu.ac.in, so a single
// change on ACAD's calendar updates every invited student's calendar and notifies them.
// Existing copies made by this route are removed by scripts/legacy-calendar-cleanup.ts.
//
// Kept as a 410 (rather than deleted) so a browser still holding the old page gets a
// clear message instead of a 404, and so nothing can create new legacy events while the
// cleanup runs.
export async function POST() {
  return NextResponse.json(
    {
      error:
        'Adding your timetable from the portal has been switched off. Your classes will arrive as calendar invites from acad@iimu.ac.in and update automatically when the timetable changes.'
    },
    { status: 410 }
  );
}
