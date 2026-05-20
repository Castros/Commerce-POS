import Link from "next/link";
import { PageHeader } from "../components/PageHeader";

const kpis = [
  { label: "School cafeteria POS", value: "Live", trend: "Lunch, books, uniforms, events" },
  { label: "Student app sync", value: "Active", trend: "Balance and purchases update" },
  { label: "Cashier permissions", value: "Limited", trend: "No admin settings access" },
  { label: "Admin controls", value: "Ready", trend: "Inventory, staff, registers, settings" }
];

export default function DashboardPage() {
  return (
    <section className="module">
      <PageHeader eyebrow="Demo command center" title="School Cafeteria POS Pilot">
        <Link className="buttonLink primary" href="/register">Open register</Link>
      </PageHeader>

      <div className="metricGrid">
        {kpis.map((kpi) => (
          <article className="metricTile" key={kpi.label}>
            <span>{kpi.label}</span>
            <strong>{kpi.value}</strong>
            <small>{kpi.trend}</small>
          </article>
        ))}
      </div>

      <div className="dashboardGrid">
        <div className="panelWide">
          <h3>Demo story</h3>
          <ul className="activityList">
            <li>School admin seeds Demo Academy with cafeteria products, students, and wallet balances.</li>
            <li>Cashier Jordan uses a register-only account with no admin permissions.</li>
            <li>Student buys lunch or a school item from the POS with their wallet balance.</li>
            <li>The educational student app immediately shows the new balance and purchase history.</li>
          </ul>
        </div>
        <div className="panelWide">
          <h3>Pitch flow for schools</h3>
          <div className="actionGrid">
            <Link className="buttonLink" href="/register">Cashier demo</Link>
            <Link className="buttonLink" href="/student-demo">Student app demo</Link>
            <Link className="buttonLink" href="/orders">Receipt lookup</Link>
            <Link className="buttonLink" href="/inventory">Inventory view</Link>
            <Link className="buttonLink" href="/settings">Admin setup</Link>
            <Link className="buttonLink" href="/staff">Employee roles</Link>
          </div>
        </div>
      </div>
    </section>
  );
}
