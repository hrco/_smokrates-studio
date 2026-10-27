const STUDIO_TIME_ZONE = 'Europe/Ljubljana';
const SUMMER_OFFSET = '+02:00';
const WINTER_OFFSET = '+01:00';
const MS_PER_DAY = 86_400_000;

const dateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: STUDIO_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const wallClockFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: STUDIO_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const labelFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

export function addDays(dateText, dayCount) {
  const date = new Date(`${dateText}T00:00:00Z`);
  return new Date(date.getTime() + dayCount * MS_PER_DAY).toISOString().slice(0, 10);
}

/** The Monday on or before a YYYY-MM-DD date. */
export function toMonday(dateText) {
  const daysSinceMonday = (new Date(`${dateText}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(dateText, -daysSinceMonday);
}

export function findCurrentMonday(now = new Date()) {
  return toMonday(dateFormat.format(now));
}

/** Reads ?week=YYYY-MM-DD. Any valid date snaps to its Monday. Anything else is ignored. */
export function readWeekFromQuery(search) {
  const value = new URLSearchParams(search).get('week');
  const isDate = value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
  return isDate ? toMonday(value) : undefined;
}

export function formatWeekLabel(weekStart) {
  return `Week of ${labelFormat.format(new Date(`${weekStart}T00:00:00Z`))}`;
}

function toWallClock(epochMs) {
  const parts = Object.fromEntries(wallClockFormat.formatToParts(new Date(epochMs)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** The API sends Ljubljana offsets, so the first 16 characters are already the Ljubljana wall clock. */
export function toInputValue(isoDateTime) {
  return isoDateTime.slice(0, 16);
}

/**
 * Turns a datetime-local value (a Ljubljana wall clock) into an ISO date-time with the right offset,
 * whatever time zone the browser is in. Returns null when that wall time does not exist (the hour the
 * clocks skip forward). When the hour repeats, the first one (summer time) wins.
 */
export function toIsoWithOffset(wallClock) {
  for (const offset of [SUMMER_OFFSET, WINTER_OFFSET]) {
    const epochMs = Date.parse(`${wallClock}:00${offset}`);
    if (!Number.isNaN(epochMs) && toWallClock(epochMs) === wallClock) return `${wallClock}:00${offset}`;
  }
  return null;
}
