const STUDIO_TIME_ZONE = 'Europe/Ljubljana';
const MS_PER_MINUTE = 60_000;
const MS_PER_SECOND = 1000;

const ISO_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const wallClockFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: STUDIO_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function readPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  const part = parts.find((candidate) => candidate.type === type);
  if (part === undefined) throw new Error(`format-ljubljana-iso: no ${type} in formatted date`);
  return Number(part.value);
}

function padTwo(value: number): string {
  return String(value).padStart(2, '0');
}

/** Formats epoch milliseconds as an ISO date-time with the Europe/Ljubljana offset, to the second. */
export function formatLjubljanaIso(epochMs: number): string {
  const wholeSecondMs = Math.floor(epochMs / MS_PER_SECOND) * MS_PER_SECOND;
  const parts = wallClockFormat.formatToParts(new Date(wholeSecondMs));
  const year = readPart(parts, 'year');
  const month = readPart(parts, 'month');
  const day = readPart(parts, 'day');
  const hour = readPart(parts, 'hour');
  const minute = readPart(parts, 'minute');
  const second = readPart(parts, 'second');

  const wallClockAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetMinutes = Math.round((wallClockAsUtcMs - wholeSecondMs) / MS_PER_MINUTE);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absoluteMinutes = Math.abs(offsetMinutes);
  const offset = `${sign}${padTwo(Math.floor(absoluteMinutes / 60))}:${padTwo(absoluteMinutes % 60)}`;
  return `${year}-${padTwo(month)}-${padTwo(day)}T${padTwo(hour)}:${padTwo(minute)}:${padTwo(second)}${offset}`;
}

/** Parses an ISO date-time that carries an offset or Z. Returns undefined for anything else. */
export function parseIsoDateTimeMs(value: string): number | undefined {
  if (!ISO_DATE_TIME_PATTERN.test(value)) return undefined;
  const epochMs = Date.parse(value);
  return Number.isNaN(epochMs) ? undefined : epochMs;
}

/** True for a real calendar date written YYYY-MM-DD that falls on a Monday. */
export function isMondayDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  const isRealDate =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return isRealDate && date.getUTCDay() === 1;
}
