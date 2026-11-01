// Real-world context the agents can look up: weather, calendar, posting patterns.
import type { Profile } from "./defaults.mts";
import { utcToLocal, weekday } from "./time.mts";

const WMO: Record<number, string> = {
  0: "clear", 1: "mostly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "fog",
  51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 61: "light rain", 63: "rain", 65: "heavy rain",
  71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains", 80: "rain showers", 81: "rain showers",
  82: "heavy showers", 85: "snow showers", 86: "heavy snow showers", 95: "thunderstorm", 96: "thunderstorm", 99: "thunderstorm",
};

export type WeatherDay = { date: string; weekday: string; high_f: number; low_f: number; precip_chance: number | null; conditions: string };
export type Weather =
  | { location: string; source: string; days: WeatherDay[] }
  | { location: string; unavailable: true; note: string };

type OpenMeteo = {
  daily: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max?: (number | null)[];
    weather_code: number[];
  };
};

export async function getWeather(profile: Profile): Promise<Weather> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${profile.latitude}&longitude=${profile.longitude}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code` +
    `&temperature_unit=fahrenheit&timezone=${encodeURIComponent(profile.timezone)}&forecast_days=7`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error(`status ${r.status}`);
    const d = (await r.json()) as OpenMeteo;
    const days: WeatherDay[] = d.daily.time.map((date, i) => ({
      date,
      weekday: new Date(date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }),
      high_f: Math.round(d.daily.temperature_2m_max[i]),
      low_f: Math.round(d.daily.temperature_2m_min[i]),
      precip_chance: d.daily.precipitation_probability_max?.[i] ?? null,
      conditions: WMO[d.daily.weather_code[i]] ?? "mixed",
    }));
    return { location: profile.city, source: "Open-Meteo live forecast", days };
  } catch {
    return { location: profile.city, unavailable: true, note: "Weather service unreachable; plan without weather." };
  }
}

function nthWeekday(year: number, month: number, weekdayIdx: number, n: number) {
  // month 0-based; weekdayIdx 0=Sun; n>=1, or -1 for last
  if (n > 0) {
    const first = new Date(Date.UTC(year, month, 1));
    const offset = (weekdayIdx - first.getUTCDay() + 7) % 7;
    return new Date(Date.UTC(year, month, 1 + offset + (n - 1) * 7));
  }
  const last = new Date(Date.UTC(year, month + 1, 0));
  const offset = (last.getUTCDay() - weekdayIdx + 7) % 7;
  return new Date(Date.UTC(year, month, last.getUTCDate() - offset));
}

function notableDates(year: number): Record<string, string> {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const f = (m: number, d: number) => `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const thanksgiving = nthWeekday(year, 10, 4, 4);
  const out: Record<string, string> = {
    [f(1, 1)]: "New Year's Day",
    [f(2, 14)]: "Valentine's Day",
    [f(3, 17)]: "St. Patrick's Day",
    [f(4, 30)]: "National Bubble Tea Day",
    [f(7, 4)]: "Independence Day",
    [f(10, 9)]: "Hangul Day (Korean Alphabet Day)",
    [f(10, 31)]: "Halloween",
    [f(11, 11)]: "Veterans Day",
    [f(12, 24)]: "Christmas Eve",
    [f(12, 25)]: "Christmas Day",
    [f(12, 31)]: "New Year's Eve",
    [iso(nthWeekday(year, 2, 6, 1))]: "National Corn Dog Day",
    [iso(nthWeekday(year, 4, 0, 2))]: "Mother's Day",
    [iso(nthWeekday(year, 5, 0, 3))]: "Father's Day",
    [iso(nthWeekday(year, 4, 1, -1))]: "Memorial Day",
    [iso(nthWeekday(year, 8, 1, 1))]: "Labor Day",
    [iso(thanksgiving)]: "Thanksgiving",
    [iso(new Date(thanksgiving.getTime() + 86400000))]: "Black Friday",
    [iso(new Date(thanksgiving.getTime() + 2 * 86400000))]: "Small Business Saturday (great for family-owned shops)",
  };
  const lunar: Record<number, string> = { 2026: "02-17", 2027: "02-06", 2028: "01-26" };
  const chuseok: Record<number, string> = { 2026: "09-25", 2027: "09-15", 2028: "10-03" };
  if (lunar[year]) out[`${year}-${lunar[year]}`] = "Lunar New Year (Seollal)";
  if (chuseok[year]) out[`${year}-${chuseok[year]}`] = "Chuseok (Korean harvest festival)";
  return out;
}

export function getCalendar(profile: Profile, days = 10) {
  const now = new Date();
  const list = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(now.getTime() + i * 86400000);
    const date = utcToLocal(d, profile.timezone).slice(0, 10);
    const year = Number(date.slice(0, 4));
    const notes = [];
    const holiday = notableDates(year)[date];
    if (holiday) notes.push(holiday);
    for (const ev of profile.events || []) if (ev.date === date) notes.push(`Local event: ${ev.name}`);
    list.push({ date, weekday: weekday(d, profile.timezone), notable: notes });
  }
  return {
    today: utcToLocal(now, profile.timezone),
    timezone: profile.timezone,
    days: list,
  };
}

export function getPostingInsights(profile: Profile) {
  return {
    business_hours: profile.hours,
    slow_times: profile.slow_times,
    active_promotions: profile.promotions,
    engagement_windows: {
      lunch: "11:00–12:30 (post ~30 min before the rush so people see it while deciding)",
      after_school: "14:30–16:30 (students; good for filling slow afternoons)",
      evening: "18:30–20:30 (highest scrolling time; good for TikTok/Instagram Reels)",
    },
    platform_audiences: {
      Instagram: "Students and young adults; visual food content performs best",
      TikTok: "Gen Z; short videos, trends, cheese pulls",
      Facebook: "Families and locals; hours, events, deals",
      Bluesky: "Small, text-first audience; conversational",
    },
    rules_of_thumb: [
      "Only schedule posts during or shortly before business hours.",
      "Use posts to fill slow periods, not just busy ones.",
      "Avoid posting about the same menu item twice within 3 days.",
      "Match drinks/food to the weather (iced fruit tea on warm days, hot milk tea and corn dogs on cold days).",
    ],
  };
}
