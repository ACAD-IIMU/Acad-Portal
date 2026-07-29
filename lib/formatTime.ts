/** Converts a 24-hour "HH:MM" string (as stored in the DB) to a 12-hour display
 * string with AM/PM, e.g. "16:45" -> "4:45 PM". */
export function formatTime12h(time24: string): string {
  const [hStr, mStr] = time24.slice(0, 5).split(':');
  let h = parseInt(hStr, 10);
  const meridiem = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${mStr} ${meridiem}`;
}
