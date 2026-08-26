/**
 * Hour-of-simulated-week -> ISO timestamp, sent as the `X-Sim-Time` header
 * so a scenario's pacing is decoupled from real wall-clock time — a "week"
 * of persona traffic can be compressed into minutes via --speed without
 * breaking business-hours/velocity policy conditions, which read
 * `X-Sim-Time` when present.
 *
 * Own copy of the repo root's `lib/expand-scenarios.ts::simHourToIso`
 * (arena has zero imports outside `arena/`) — deliberately the SAME
 * reference week (Monday 2026-08-03) so an arena run against a Kit-1-seeded
 * org lines up with that kit's own business-hours windows without arena
 * needing to know the kit's internal calendar math.
 */
const SIM_WEEK_START_YEAR = 2026;
const SIM_WEEK_START_MONTH_INDEX = 7; // August (0-indexed)
const SIM_WEEK_START_DAY = 3; // a Monday

export function simHourToIso(hourOfWeek: number): string {
  const dayOffset = Math.floor(hourOfWeek / 24);
  const hourOfDay = hourOfWeek % 24;
  // Date.UTC, not the local constructor: this timestamp is sent as
  // X-Sim-Time to a backend that reads hour/day_of_week in UTC
  // (engine/context/time.ts). Building it from the CALLER's local
  // timezone means "hour 9" only lands on the server as hour 9 when
  // caller and server share a timezone — false on a non-UTC laptop
  // hitting a UTC-hosted backend, silently shifting every business-hours
  // check.
  const d = new Date(Date.UTC(SIM_WEEK_START_YEAR, SIM_WEEK_START_MONTH_INDEX, SIM_WEEK_START_DAY + dayOffset, hourOfDay, 0, 0, 0));
  return d.toISOString();
}

/** Business hours per the kit convention: Mon-Fri 09:00-17:00 -> hours [9-17,33-41,57-65,81-89,105-113]. */
export function isBusinessHour(hourOfWeek: number): boolean {
  const hourOfDay = hourOfWeek % 24;
  const dayOfWeek = Math.floor(hourOfWeek / 24); // 0=Mon .. 6=Sun
  return dayOfWeek >= 0 && dayOfWeek <= 4 && hourOfDay >= 9 && hourOfDay < 17;
}

/** A late-night hour (outside business hours, deep in the night) — used by night-burster. */
export function lateNightHour(dayOfWeek: number): number {
  return dayOfWeek * 24 + 2; // 02:00 on the given simulated day
}
