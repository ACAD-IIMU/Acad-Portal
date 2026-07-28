type EventRow = {
  id: string;
  event_date: string;
  type: 'quiz' | 'endterm' | 'other';
  label: string;
};

export default function Reminders({ events }: { events: EventRow[] }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const upcoming = events
    .map((e) => {
      const d = new Date(e.event_date);
      const daysAway = Math.round((d.getTime() - today.getTime()) / 86400000);
      return { ...e, daysAway };
    })
    .filter((e) => e.daysAway >= 0)
    .slice(0, 2);

  return (
    <div className="card p-5">
      <h2 className="text-sm mb-3">Reminders</h2>
      <div className="flex flex-col gap-2.5">
        {/* SR Elections reminder is currently static — wire to a real elections table
            when the SR Elections screen is built. */}
        <ReminderItem icon="🗳️">
          SR Elections for {upcoming.length ? 'this term' : 'the current term'} close soon — cast your vote.
        </ReminderItem>

        {upcoming.length === 0 && (
          <p className="text-xs text-inkFaint italic">No upcoming quizzes or exams on the calendar.</p>
        )}
        {upcoming.map((e) => {
          const icon = e.type === 'endterm' ? '🎓' : '📝';
          const when = e.daysAway === 0 ? 'today' : e.daysAway === 1 ? 'tomorrow' : `in ${e.daysAway} days`;
          const dateLabel = new Date(e.event_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
          return (
            <ReminderItem key={e.id} icon={icon}>
              {e.label} — <b>{dateLabel}</b> ({when})
            </ReminderItem>
          );
        })}
      </div>
    </div>
  );
}

function ReminderItem({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-xs text-inkSoft bg-brand-50 rounded-lg px-3 py-2.5 leading-relaxed">
      <span className="shrink-0">{icon}</span>
      <span>{children}</span>
    </div>
  );
}
