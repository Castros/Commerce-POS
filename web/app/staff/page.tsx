import { PageHeader } from "../components/PageHeader";

export default function StaffPage() {
  return (
    <section className="module">
      <PageHeader eyebrow="Admin" title="Cash Register Employees & Permissions">
        <button type="button">Invite employee</button>
      </PageHeader>
      <div className="permissionStrip">
        <div>
          <span>Demo cashier</span>
          <strong>Jordan Lee</strong>
          <small>Can sell, select students, and complete wallet sales only.</small>
        </div>
        <div>
          <span>Manager</span>
          <strong>Riley Patel</strong>
          <small>Can adjust inventory, review orders, and close registers.</small>
        </div>
        <div>
          <span>Admin</span>
          <strong>School operations</strong>
          <small>Can manage settings, roles, integrations, and reports.</small>
        </div>
      </div>
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th>Role</th>
              <th>Register</th>
              <th>Allowed</th>
              <th>Blocked</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Jordan Lee</td>
              <td>Cashier</td>
              <td>Lunch Line 02</td>
              <td>Sales, receipts, student lookup</td>
              <td>Inventory edits, settings, staff, reports</td>
            </tr>
            <tr>
              <td>Riley Patel</td>
              <td>Manager</td>
              <td>Cafeteria</td>
              <td>Sales, inventory, refunds, drawer close</td>
              <td>System integrations</td>
            </tr>
            <tr>
              <td>Avery Brooks</td>
              <td>Admin</td>
              <td>All stores</td>
              <td>Full school POS administration</td>
              <td>None</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
