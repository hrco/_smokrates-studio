export function addDays(dateText: string, dayCount: number): string;
export function toMonday(dateText: string): string;
export function findCurrentMonday(now?: Date): string;
export function readWeekFromQuery(search: string): string | undefined;
export function formatWeekLabel(weekStart: string): string;
export function toInputValue(isoDateTime: string): string;
export function toIsoWithOffset(wallClock: string): string | null;
