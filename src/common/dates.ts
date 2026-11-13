import { Day } from './enums';

export const addHours = (d: Date, h: number) => new Date(d.getTime() + h * 3_600_000);

const DAY_BY_INDEX = [Day.SUN, Day.MON, Day.TUE, Day.WED, Day.THU, Day.FRI, Day.SAT];
export const dayOf = (d: Date): Day => DAY_BY_INDEX[d.getDay()]!;

/** YYYY-MM-DD in the server's local time. */
export const dateStr = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export const endTime = (start: string, hours = 2) => `${String(Number(start.slice(0, 2)) + hours).padStart(2, '0')}:${start.slice(3, 5)}`;

export const iso = (d?: Date | null) => (d ? new Date(d).toISOString() : null);
