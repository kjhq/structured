import { config } from "./config.js";

export function todayYmd(d = new Date(), tz?: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz ?? config.TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function todayHuman(d = new Date(), tz?: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz ?? config.TIMEZONE,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
}

/** Local clock time, e.g. "3:45 PM". */
export function nowLocal(d = new Date(), tz?: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz ?? config.TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

/** Format server YYYY-MM-DD as a human date in the user's timezone. */
export function ymdToHuman(ymd: string, tz?: string): string {
  const [y, m, d] = ymd.split("-").map((n) => Number.parseInt(n, 10));
  const noonUtc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz ?? config.TIMEZONE,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(noonUtc);
}
