import Link from "next/link";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";

const locationMetrics = [
  { label: "Open locations", value: "4", trend: "Cafeteria, campus store, north line, events" },
  { label: "Today sales", value: "$4,286", trend: "All stores combined" },
  { label: "Open drawers", value: "3", trend: "One drawer pending closeout" },
  { label: "Low stock alerts", value: "7", trend: "Across cafeteria and campus store" }
];

const locations = [
  {
    name: "Main Cafeteria",
    type: "Cafeteria",
    manager: "Riley Patel",
    status: "Open",
    sales: "$2,145.50",
    orders: 318,
    drawer: "$1,184.25",
    inventory: "3 low",
    registers: "Lunch Line 01, Lunch Line 02"
  },
  {
    name: "North Cafeteria Line",
    type: "Cafeteria",
    manager: "Monica Rivera",
    status: "Open",
    sales: "$936.75",
    orders: 144,
    drawer: "$428.00",
    inventory: "2 low",
    registers: "North Line 01"
  },
  {
    name: "Campus Store",
    type: "Uniforms & Books",
    manager: "Avery Brooks",
    status: "Open",
    sales: "$1,023.00",
    orders: 42,
    drawer: "$612.00",
    inventory: "2 low",
    registers: "Store Counter"
  },
  {
    name: "Athletics Event Stand",
    type: "Event Sales",
    manager: "Jordan Lee",
    status: "Closed",
    sales: "$181.00",
    orders: 23,
    drawer: "$0.00",
    inventory: "OK",
    registers: "Event Mobile 01"
  }
];

const configurationAreas = [
  ["Stores", "Create locations, set type, hours, tax profile, and active status"],
  ["Registers", "Assign drawers, devices, receipts, and cashier access per location"],
  ["Products", "Share catalog items or limit products to a specific store"],
  ["Inventory", "Track stock per location and transfer items between locations"],
  ["Staff", "Assign super admins globally and managers/cashiers to specific stores"],
  ["Reports", "Compare sales, drawer variance, stock alerts, and refunds across stores"]
];

export default function LocationsPage() {
  return (
    <section className="module">
      <PageHeader eyebrow="Super admin" title="Multi-Location Overview">
        <Link className="buttonLink primary" href="/settings">Configure stores</Link>
      </PageHeader>

      <div className="permissionStrip">
        <div>
          <span>Current role</span>
          <strong>Super Admin</strong>
          <small>Can configure every location, register, staff assignment, inventory rule, and report.</small>
        </div>
        <div>
          <span>Store managers</span>
          <strong>Location scoped</strong>
          <small>Managers see and operate only assigned stores unless promoted.</small>
        </div>
        <div>
          <span>Cashiers</span>
          <strong>Register scoped</strong>
          <small>Cashiers sell from assigned registers and cannot change admin setup.</small>
        </div>
      </div>

      <div className="metricGrid">
        {locationMetrics.map((metric) => (
          <article className="metricTile" key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.trend}</small>
          </article>
        ))}
      </div>

      <div className="dashboardGrid">
        <div className="panelWide fullWidth">
          <h3>Store health</h3>
          <div className="tableWrap locationTable">
            <table>
              <thead>
                <tr>
                  <th>Location</th>
                  <th>Status</th>
                  <th>Manager</th>
                  <th>Today sales</th>
                  <th>Orders</th>
                  <th>Drawer</th>
                  <th>Inventory</th>
                  <th>Registers</th>
                </tr>
              </thead>
              <tbody>
                {locations.map((location) => (
                  <tr key={location.name}>
                    <td>
                      <strong>{location.name}</strong>
                      <small>{location.type}</small>
                    </td>
                    <td><StatusBadge value={location.status} /></td>
                    <td>{location.manager}</td>
                    <td>{location.sales}</td>
                    <td>{location.orders}</td>
                    <td>{location.drawer}</td>
                    <td>{location.inventory}</td>
                    <td>{location.registers}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panelWide">
          <h3>Super admin workflow</h3>
          <ul className="activityList">
            <li>Create each school store or business location from one admin area.</li>
            <li>Assign managers to locations and cashiers to specific registers.</li>
            <li>Review sales, refunds, stock alerts, and drawer closeout variance across all stores.</li>
            <li>Drill into a location to manage its products, inventory, receipts, and staff.</li>
          </ul>
        </div>

        <div className="panelWide">
          <h3>Configuration areas</h3>
          <div className="locationConfigGrid">
            {configurationAreas.map(([title, description]) => (
              <Link className="buttonLink locationConfigLink" href="/settings" key={title}>
                <strong>{title}</strong>
                <small>{description}</small>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
