"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../lib/api";

type CurrentSession = {
  user: {
    name: string | null;
    email: string | null;
    role: string;
    organizationName: string | null;
  };
};

const navItems = [
  ["Dashboard", "/dashboard", "dashboard", "All"],
  ["Register", "/register", "point_of_sale", "Cashier"],
  ["Orders", "/orders", "receipt_long", "Cashier"],
  ["Inventory", "/inventory", "inventory_2", "Manager"],
  ["Products", "/products", "restaurant_menu", "Manager"],
  ["Customers", "/customers", "school", "Cashier"],
  ["Student App", "/student-demo", "account_child", "Family"],
  ["Reports", "/reports", "monitoring", "Admin"],
  ["Organizations", "/organizations", "corporate_fare", "Platform"],
  ["Staff", "/staff", "badge", "Admin"],
  ["Settings", "/settings", "settings", "Admin"]
] as const;

const SIDEBAR_KEY = "commerce_pos_sidebar_collapsed";
const publicPaths = new Set(["/login", "/register-login"]);
const workspaceRoles = new Set(["super_admin", "organization_admin", "store_manager", "admin", "manager"]);

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [session, setSession] = useState<CurrentSession | null>(null);
  const isRegisterPath = pathname === "/register" || pathname.startsWith("/register/");
  const canAccessWorkspace = workspaceRoles.has(session?.user.role || "");

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(SIDEBAR_KEY) === "true");
  }, []);

  useEffect(() => {
    if (publicPaths.has(pathname)) {
      return;
    }

    let cancelled = false;
    apiGet<CurrentSession>("/auth/me")
      .then((currentSession) => {
        if (!cancelled) {
          setSession(currentSession);
        }
      })
      .catch(() => {
        if (!cancelled) {
          router.replace(`/login?next=${encodeURIComponent(pathname)}`);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  function toggleSidebar() {
    setCollapsed((current) => {
      const next = !current;
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

  if (publicPaths.has(pathname)) {
    return <>{children}</>;
  }

  if (isRegisterPath) {
    return (
      <div className="registerShell">
        <header className="registerTopbar">
          <Link className="registerBrand" href="/register">
            <span className="brandMark">
              <span className="material-symbols-outlined fill" aria-hidden="true">
                local_cafe
              </span>
            </span>
            <div>
              <strong>Commerce POS</strong>
              <span>Cafeteria register</span>
            </div>
          </Link>
          <nav className="registerTerminalNav" aria-label="Register tools">
            <Link className={pathname === "/register" ? "active" : ""} href="/register">
              <span className="material-symbols-outlined" aria-hidden="true">
                point_of_sale
              </span>
              Register
            </Link>
            <Link className={pathname === "/register/orders" ? "active" : ""} href="/register/orders">
              <span className="material-symbols-outlined" aria-hidden="true">
                receipt_long
              </span>
              Orders / Refunds
            </Link>
            <Link
              className={pathname === "/register/customers" ? "active" : ""}
              href="/register/customers"
            >
              <span className="material-symbols-outlined" aria-hidden="true">
                person_add
              </span>
              Add Customer
            </Link>
          </nav>
          <div className="registerTopbarMeta">
            <span>Main Store</span>
            <strong>Terminal 01</strong>
            <span className="sync">Online</span>
          </div>
          <div className="registerSession">
            <span>{session?.user.name || session?.user.email || "Cashier session"}</span>
            {canAccessWorkspace ? (
              <Link className="workspaceLink" href="/dashboard">
                Admin Workspace
              </Link>
            ) : null}
            <button type="button" onClick={logout} disabled={loggingOut}>
              <span className="material-symbols-outlined" aria-hidden="true">
                lock
              </span>
              {loggingOut ? "Locking" : "Lock Register"}
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
              <span className="material-symbols-outlined fill" aria-hidden="true">
                local_cafe
              </span>
            </span>
            <div>
              <strong>Commerce POS</strong>
              <span>Organization workspace</span>
            </div>
          </Link>
          <button
            type="button"
            className="sidebarToggle"
            aria-label={collapsed ? "Open sidebar" : "Collapse sidebar"}
            title={collapsed ? "Open sidebar" : "Collapse sidebar"}
            onClick={toggleSidebar}
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              {collapsed ? "menu_open" : "menu"}
            </span>
          </button>
        </div>

        <nav className="navList" aria-label="Primary navigation">
          {navItems.map(([item, href, icon, role]) => (
            <Link href={href} key={item} className={pathname === href ? "active" : ""} title={item}>
              <span className="navIcon">
                <span className="material-symbols-outlined" aria-hidden="true">
                  {icon}
                </span>
              </span>
              <span className="navText">
                {item}
                <small>{role}</small>
              </span>
            </Link>
          ))}
        </nav>

        <div className="sidebarFooter">
          <button type="button" title="Support">
            <span className="material-symbols-outlined" aria-hidden="true">
              help
            </span>
            <span>Support</span>
          </button>
          <button type="button" onClick={logout} disabled={loggingOut} title="Sign out">
            <span className="material-symbols-outlined" aria-hidden="true">
              logout
            </span>
            <span>{loggingOut ? "Signing out" : "Sign out"}</span>
          </button>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="selectors">
            <span className="topbarOrg">{session?.user.organizationName ?? "Organization"}</span>
            <span className="sync">Online</span>
          </div>
          <label className="globalSearch">
            <span className="material-symbols-outlined" aria-hidden="true">
              search
            </span>
            <input placeholder="Receipt, product, student, SKU" />
          </label>
          <div className="userMenu">
            <span>Staff session</span>
            <button type="button" onClick={logout} title="Sign out" disabled={loggingOut}>
              <span className="material-symbols-outlined" aria-hidden="true">
                logout
              </span>
            </button>
          </div>
        </header>

        <main className="content">{children}</main>
      </div>
    </div>
  );
}
