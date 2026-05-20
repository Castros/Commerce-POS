import Link from "next/link";

const navItems = [
  ["Dashboard", "/dashboard", "All"],
  ["Register", "/register", "Cashier"],
  ["Orders", "/orders", "Cashier"],
  ["Inventory", "/inventory", "Manager"],
  ["Products", "/products", "Manager"],
  ["Customers", "/customers", "Cashier"],
  ["Student App", "/student-demo", "Family"],
  ["Reports", "/reports", "Admin"],
  ["Staff", "/staff", "Admin"],
  ["Settings", "/settings", "Admin"]
];

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="appShell">
      <aside className="sidebar">
        <Link className="brand" href="/dashboard">
          <span className="brandMark">CP</span>
          <div>
            <strong>Commerce POS</strong>
            <span>Demo Academy</span>
          </div>
        </Link>
        <nav className="navList" aria-label="Primary navigation">
          {navItems.map(([item, href, role]) => (
            <Link href={href} key={item}>
              <span className="navIcon">{item.slice(0, 1)}</span>
              <span className="navText">
                {item}
                <small>{role}</small>
              </span>
            </Link>
          ))}
        </nav>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="selectors">
            <button type="button">Demo Academy</button>
            <button type="button">Cafeteria</button>
            <span className="sync">Online</span>
          </div>
          <label className="globalSearch">
            <span>Search</span>
            <input placeholder="Receipt, product, student, SKU" />
          </label>
          <div className="userMenu">
            <span>Cashier: Jordan - no admin permissions</span>
            <button type="button">Menu</button>
          </div>
        </header>

        <main className="content">{children}</main>
      </div>
    </div>
  );
}
