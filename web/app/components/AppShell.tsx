"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../lib/api";
import { useLanguage } from "../lib/i18n/LanguageContext";

type OrgFeatures = Record<string, boolean>;

type CurrentSession = {
  user: {
    name: string | null;
    email: string | null;
    role: string;
    organizationName: string | null;
    orgFeatures?: OrgFeatures;
  };
};

const NAV_ITEMS = [
  { key: "nav.dashboard",     href: "/dashboard",     icon: "dashboard",       role: "All",      feature: null },
  { key: "nav.register",      href: "/register",      icon: "point_of_sale",   role: "Cashier",  feature: null },
  { key: "nav.orders",        href: "/orders",        icon: "receipt_long",    role: "Cashier",  feature: null },
  { key: "nav.inventory",     href: "/inventory",     icon: "inventory_2",     role: "Manager",  feature: null },
  { key: "nav.products",      href: "/products",      icon: "restaurant_menu", role: "Manager",  feature: null },
  { key: "nav.customers",     href: "/customers",     icon: "school",          role: "Cashier",  feature: null },
  { key: "nav.guardians",     href: "/guardians",     icon: "family_restroom", role: "Manager",  feature: "guardians" },
  { key: "nav.employees",     href: "/employees",     icon: "badge",           role: "Manager",  feature: "payroll" },
  { key: "nav.fees",          href: "/fees",          icon: "request_quote",   role: "Manager",  feature: "fee_assignments" },
  { key: "nav.payroll",       href: "/payroll",       icon: "payments",        role: "Admin",    feature: "payroll" },
  { key: "nav.studentApp",    href: "/student-demo",  icon: "account_child",   role: "Family",   feature: "student_integration" },
  { key: "nav.reports",       href: "/reports",       icon: "monitoring",      role: "Admin",    feature: null },
  { key: "nav.organizations", href: "/organizations", icon: "corporate_fare",  role: "Platform", feature: null },
  { key: "nav.staff",         href: "/staff",         icon: "person_pin",      role: "Admin",    feature: null },
  { key: "nav.settings",      href: "/settings",      icon: "settings",        role: "Admin",    feature: null }
];

const SIDEBAR_KEY = "commerce_pos_sidebar_collapsed";
const publicPaths = new Set(["/login", "/register-login"]);
const workspaceRoles = new Set(["super_admin", "organization_admin", "store_manager", "admin", "manager"]);

// Numeric access level per DB role — higher = more access
const ROLE_LEVEL: Record<string, number> = {
  cashier:              1,
  accountant:           1,
  store_manager:        2,
  organization_owner:   3,
  organization_admin:   3,
  super_admin:          4,
  platform_admin:       4,
  service:              4
};

// Minimum level required per nav role label
const NAV_MIN_LEVEL: Record<string, number> = {
  All:      0,
  Family:   1,
  Cashier:  1,
  Manager:  2,
  Admin:    3,
  Platform: 4
};

const PLATFORM_ROLES = new Set(["platform_admin", "super_admin", "service"]);

function canSeeNavItem(userRole: string, navRole: string, feature: string | null, orgFeatures: OrgFeatures | undefined): boolean {
  const userLevel = ROLE_LEVEL[userRole] ?? 0;
  const required  = NAV_MIN_LEVEL[navRole] ?? 99;
  if (userLevel < required) return false;
  if (!feature) return true;
  // Platform admins always see everything
  if (PLATFORM_ROLES.has(userRole)) return true;
  return (orgFeatures?.[feature] ?? true) !== false;
}

function LangToggle() {
  const { lang, setLang } = useLanguage();
  return (
    <button
      type="button"
      className="langToggle"
      title="Switch language / Cambiar idioma"
      onClick={() => setLang(lang === "es" ? "en" : "es")}
    >
      <span className="material-symbols-outlined" aria-hidden="true">translate</span>
      <span>{lang === "es" ? "EN" : "ES"}</span>
    </button>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { t, lang } = useLanguage();
  const [collapsed, setCollapsed] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [session, setSession] = useState<CurrentSession | null>(null);
  const isRegisterPath = pathname === "/register" || pathname.startsWith("/register/");
  const canAccessWorkspace = workspaceRoles.has(session?.user.role || "");

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(SIDEBAR_KEY) === "true");
  }, []);

  useEffect(() => {
    if (publicPaths.has(pathname)) return;
    let cancelled = false;
    apiGet<CurrentSession>("/auth/me")
      .then((s) => { if (!cancelled) setSession(s); })
      .catch(() => { if (!cancelled) router.replace(`/login?next=${encodeURIComponent(pathname)}`); });
    return () => { cancelled = true; };
  }, [pathname, router]);

  function toggleSidebar() {
    setCollapsed((cur) => {
      const next = !cur;
      window.localStorage.setItem(SIDEBAR_KEY, String(next));
      return next;
    });
  }

  async function logout() {
    setLoggingOut(true);
    try {
      await apiPost("/auth/logout", {});
    } finally {
      window.location.assign(isRegisterPath ? "/register-login" : "/login");
    }
  }

  if (publicPaths.has(pathname)) return <>{children}</>;

  // Parent portal has its own layout — skip AppShell entirely
  if (pathname.startsWith("/parent")) return <>{children}</>;

  if (isRegisterPath) {
    return (
      <div className="registerShell">
        <header className="registerTopbar">
          <Link className="registerBrand" href="/register">
            <span className="brandMark">
              <span className="material-symbols-outlined fill" aria-hidden="true">local_cafe</span>
            </span>
            <div>
              <strong>Commerce POS</strong>
              <span>{t("shell.cafeteriaRegister")}</span>
            </div>
          </Link>
          <nav className="registerTerminalNav" aria-label="Register tools">
            <Link className={pathname === "/register" ? "active" : ""} href="/register">
              <span className="material-symbols-outlined" aria-hidden="true">point_of_sale</span>
              {t("nav.register")}
            </Link>
            <Link className={pathname === "/register/orders" ? "active" : ""} href="/register/orders">
              <span className="material-symbols-outlined" aria-hidden="true">receipt_long</span>
              {t("shell.ordersRefunds")}
            </Link>
            <Link className={pathname === "/register/customers" ? "active" : ""} href="/register/customers">
              <span className="material-symbols-outlined" aria-hidden="true">person_add</span>
              {t("shell.addCustomer")}
            </Link>
          </nav>
          <div className="registerTopbarMeta">
            {session?.user.organizationName && (
              <strong>{session.user.organizationName}</strong>
            )}
            <span className="sync">{t("shell.online")}</span>
          </div>
          <div className="registerSession">
            <span>{session?.user.name || session?.user.email || t("shell.cashierSession")}</span>
            {canAccessWorkspace ? (
              <Link className="workspaceLink" href="/dashboard">{t("shell.adminWorkspace")}</Link>
            ) : null}
            <LangToggle />
            <button type="button" onClick={logout} disabled={loggingOut}>
              <span className="material-symbols-outlined" aria-hidden="true">lock</span>
              {loggingOut ? t("shell.locking") : t("shell.lockRegister")}
            </button>
          </div>
        </header>
        <main className="registerContent">{children}</main>
      </div>
    );
  }

  return (
    <div className={`appShell${collapsed ? " sidebarCollapsed" : ""}`}>
      <aside className="sidebar">
        <div className="sidebarHeader">
          <Link className="brand" href="/dashboard">
            <span className="brandMark">
              <span className="material-symbols-outlined fill" aria-hidden="true">local_cafe</span>
            </span>
            <div>
              <strong>Commerce POS</strong>
              <span>{t("shell.orgWorkspace")}</span>
            </div>
          </Link>
          <button
            type="button"
            className="sidebarToggle"
            aria-label={collapsed ? t("shell.openSidebar") : t("shell.collapseSidebar")}
            title={collapsed ? t("shell.openSidebar") : t("shell.collapseSidebar")}
            onClick={toggleSidebar}
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              {collapsed ? "menu_open" : "menu"}
            </span>
          </button>
        </div>

        <nav className="navList" aria-label="Primary navigation">
          {NAV_ITEMS.filter(({ role, feature }) =>
            canSeeNavItem(session?.user.role ?? "", role, feature, session?.user.orgFeatures)
          ).map(({ key, href, icon }) => (
            <Link href={href} key={href} className={pathname === href ? "active" : ""} title={t(key)}>
              <span className="navIcon">
                <span className="material-symbols-outlined" aria-hidden="true">{icon}</span>
              </span>
              <span className="navText">
                {t(key)}
              </span>
            </Link>
          ))}
        </nav>

        <div className="sidebarFooter">
          <LangToggle />
          <button type="button" title={t("shell.support")}>
            <span className="material-symbols-outlined" aria-hidden="true">help</span>
            <span>{t("shell.support")}</span>
          </button>
          <button type="button" onClick={logout} disabled={loggingOut} title={t("shell.signOut")}>
            <span className="material-symbols-outlined" aria-hidden="true">logout</span>
            <span>{loggingOut ? t("shell.signingOut") : t("shell.signOut")}</span>
          </button>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="selectors">
            <span className="topbarOrg">{session?.user.organizationName ?? t("common.organization")}</span>
            <span className="sync">{t("shell.online")}</span>
          </div>
          <label className="globalSearch">
            <span className="material-symbols-outlined" aria-hidden="true">search</span>
            <input placeholder={t("shell.searchPlaceholder")} />
          </label>
          <div className="userMenu">
            <span>{t("shell.staffSession")}</span>
            <button type="button" onClick={logout} title={t("shell.signOut")} disabled={loggingOut}>
              <span className="material-symbols-outlined" aria-hidden="true">logout</span>
            </button>
          </div>
        </header>

        <main className="content">{children}</main>
      </div>
    </div>
  );
}
