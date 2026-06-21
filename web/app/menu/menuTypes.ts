export type Product = { id: string; name: string; priceCents: number };
export type MenuItem = { productId: string; name: string; priceCents: number };

export type PeriodEntry = {
  id?: string;
  date: string;
  mealPeriod: string;
  items: MenuItem[];
  published: boolean;
  notes: string | null;
};

export const PERIOD_SUGGESTIONS = ["Almuerzo", "Comida", "Cena", "Merienda", "Desayuno"];

export function getWeekStart(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const m = new Date(d);
  m.setDate(d.getDate() + diff);
  m.setHours(0, 0, 0, 0);
  return m;
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatWeekRange(start: Date): string {
  const end = addDays(start, 4);
  const o: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  return `${start.toLocaleDateString("es-MX", o)} – ${end.toLocaleDateString("es-MX", { ...o, year: "numeric" })}`;
}

export function formatDayLabel(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00");
  return {
    short: d.toLocaleDateString("es-MX", { month: "short", day: "numeric" }).toUpperCase(),
    weekday: d.toLocaleDateString("es-MX", { weekday: "long" }),
  };
}

export function fmt(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}
