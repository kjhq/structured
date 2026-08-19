export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map((n) => Number.parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export type ParsedWhen = {
  day?: string;
  start_time?: string;
  is_all_day: boolean;
};

function padHm(hour: string, minute: string): string {
  return `${hour.padStart(2, "0")}:${minute}`;
}

export function parseWhen(
  when: string | undefined,
  today: string,
): ParsedWhen | { error: string } {
  if (!when || !when.trim()) {
    return { is_all_day: false };
  }
  const v = when.trim();
  const lower = v.toLowerCase();
  if (lower === "today") return { day: today, is_all_day: true };
  if (lower === "tomorrow") return { day: addDays(today, 1), is_all_day: true };

  const ymdHm = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})$/.exec(v);
  if (ymdHm) {
    return {
      day: ymdHm[1],
      start_time: padHm(ymdHm[2], ymdHm[3]),
      is_all_day: false,
    };
  }
  const ymd = /^(\d{4}-\d{2}-\d{2})$/.exec(v);
  if (ymd) return { day: ymd[1], is_all_day: true };

  const hm = /^(\d{1,2}):(\d{2})$/.exec(v);
  if (hm) {
    return { day: today, start_time: padHm(hm[1], hm[2]), is_all_day: false };
  }
  return {
    error: "when must be YYYY-MM-DD, today, tomorrow, HH:MM, or YYYY-MM-DD HH:MM",
  };
}
