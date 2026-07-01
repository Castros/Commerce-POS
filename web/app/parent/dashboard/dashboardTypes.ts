export const CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ?? "";

export function avatarUrl(publicId: string | null | undefined, size = 40) {
  if (!publicId || !CLOUD_NAME) return null;
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/w_${size},h_${size},c_fill,r_max,f_auto,q_auto/${publicId}`;
}

export type Transaction = {
  id: string;
  createdAt: string;
  totalCents: number;
  paymentMethod: string;
  storeName: string | null;
  items: string[];
};

export type Student = {
  id: string;
  name: string;
  avatarPublicId: string | null;
  homeStoreId: string | null;
  homeStoreName: string | null;
  balanceCents: number;
  currency: string;
  creditLimitCents: number;
  relationship: string;
  isPrimary: boolean;
  recentTransactions: Transaction[];
};

export type MenuDay = {
  date: string;
  mealPeriod: string;
  items: { productId: string; name: string; priceCents: number }[];
  notes: string | null;
};

export type NotificationPrefs = {
  email_on_purchase: boolean;
  low_balance_threshold_cents: number;
};

export type GuardianMe = {
  id: string;
  name: string;
  email: string;
  organizationId: string;
  organizationName: string;
  notificationPrefs: NotificationPrefs;
  students: Student[];
};

export type Category = { id: string; name: string };
export type SpendingControls = { daily_limit_cents: number | null; blocked_category_ids: string[] };
export type ControlsData = { spendingControls: SpendingControls; availableCategories: Category[] };

export type Tab = "home" | "menu" | "historial" | "ajustes";
export type MenuByStore = Record<string, MenuDay[]>;

export const DAY_SHORT = ["Lun", "Mar", "Mié", "Jue", "Vie"];

export function getWeekDates(offset = 0): string[] {
  const today = new Date();
  const day = today.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(today);
  monday.setDate(today.getDate() + diff + offset * 7);
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function formatMoney(cents: number, currency = "USD") {
  const abs = Math.abs(cents) / 100;
  const formatted = abs.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return cents < 0 ? `-$${formatted}` : `$${formatted}`;
}

export function formatDayFull(dateStr: string) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
}

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}

export function groupDateLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Hoy";
  if (d.toDateString() === yesterday.toDateString()) return "Ayer";
  return d.toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" });
}

export function initials(name: string) {
  return name.split(" ").slice(0, 2).map((n) => n[0]).join("").toUpperCase();
}
