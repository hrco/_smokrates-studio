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

type WallClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  wholeSecondMs: number;
};

function readWallClock(epochMs: number): WallClock {
  const wholeSecondMs = Math.floor(epochMs / MS_PER_SECOND) * MS_PER_SECOND;
  const parts = wallClockFormat.formatToParts(new Date(wholeSecondMs));
  return {
    year: readPart(parts, 'year'),
    month: readPart(parts, 'month'),
    day: readPart(parts, 'day'),
    hour: readPart(parts, 'hour'),
    minute: readPart(parts, 'minute'),
    second: readPart(parts, 'second'),
    wholeSecondMs,
  };
}

function offsetMinutesAt(epochMs: number): number {
  const clock = readWallClock(epochMs);
  const wallClockAsUtcMs = Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second);
  return Math.round((wallClockAsUtcMs - clock.wholeSecondMs) / MS_PER_MINUTE);
}

function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absoluteMinutes = Math.abs(offsetMinutes);
  return `${sign}${padTwo(Math.floor(absoluteMinutes / 60))}:${padTwo(absoluteMinutes % 60)}`;
}

/** Formats epoch milliseconds as an ISO date-time with the Europe/Ljubljana offset, to the second. */
export function formatLjubljanaIso(epochMs: number): string {
  const clock = readWallClock(epochMs);
  const offset = formatOffset(offsetMinutesAt(epochMs));
  const date = `${clock.year}-${padTwo(clock.month)}-${padTwo(clock.day)}`;
  const time = `${padTwo(clock.hour)}:${padTwo(clock.minute)}:${padTwo(clock.second)}`;
  return `${date}T${time}${offset}`;
}

/**
 * Epoch milliseconds of local midnight on the Europe/Ljubljana day that contains epochMs.
 * Midnight exists on both DST change days: the clock moves at 02:00, not at 00:00.
 */
export function ljubljanaDayStartMs(epochMs: number): number {
  const clock = readWallClock(epochMs);
  const date = `${clock.year}-${padTwo(clock.month)}-${padTwo(clock.day)}`;
  const utcMidnightMs = Date.UTC(clock.year, clock.month - 1, clock.day);
  let startMs = utcMidnightMs;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    startMs = utcMidnightMs - offsetMinutesAt(startMs) * MS_PER_MINUTE;
  }
  const formatted = formatLjubljanaIso(startMs);
  if (!formatted.startsWith(`${date}T00:00:00`)) {
    throw new Error(`ljubljana-day-start: ${startMs} formatted as ${formatted}, want ${date}T00:00:00`);
  }
  return startMs;
}

/** Epoch milliseconds of local midnight on the next Europe/Ljubljana day. A DST day is 23 or 25 hours. */
export function nextLjubljanaDayStartMs(epochMs: number): number {
  const dayStartMs = ljubljanaDayStartMs(epochMs);
  return ljubljanaDayStartMs(dayStartMs + 26 * 60 * MS_PER_MINUTE);
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
