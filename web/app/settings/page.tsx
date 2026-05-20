import { PageHeader } from "../components/PageHeader";

const settings = [
  ["School profile", "Demo Academy, cafeteria, campus store"],
  ["Meal taxes & exemptions", "Configure school tax rules"],
  ["Receipt templates", "Lunch receipt, parent email, reprint"],
  ["Cash registers", "Lunch Line 01, Lunch Line 02, Campus Store"],
  ["Inventory rules", "Low stock thresholds and receiving"],
  ["Discounts & meal programs", "Free/reduced lunch and staff discounts"],
  ["Student app integration", "External student IDs and wallet sync"],
  ["Employee permissions", "Cashier, manager, admin"],
  ["Audit log", "Wallet charges, refunds, register activity"]
];

export default function SettingsPage() {
  return (
    <section className="module">
      <PageHeader eyebrow="Admin configuration" title="School POS Settings" />
      <div className="permissionStrip">
        <div>
          <span>Admin area</span>
          <strong>Cashier access blocked</strong>
          <small>Only managers/admins can change registers, taxes, integrations, and roles.</small>
        </div>
        <div>
          <span>Student app bridge</span>
          <strong>External IDs mapped</strong>
          <small>School/student records connect POS wallets to the educational app.</small>
        </div>
      </div>
      <div className="settingsGrid">
        {settings.map(([item, description]) => (
          <button className="settingRow" type="button" key={item}>
            <strong>{item}</strong>
            <small>{description}</small>
            <span>Open</span>
          </button>
        ))}
      </div>
    </section>
  );
}
