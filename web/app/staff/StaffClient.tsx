"use client";

import { useEffect, useMemo, useState } from "react";

import { PageHeader } from "../components/PageHeader";
import { apiGet, apiPost } from "../lib/api";
import { formatMoney } from "../lib/format";
import type { DemoSchoolData, Wallet } from "../lib/demoTypes";
import { loadCurrentOrganization, loadCurrentStore } from "../lib/organizationContext";

type Customer = {
  id: string;
  organizationId: string;
  externalStudentId: string | null;
  externalParentId: string | null;
  externalId: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  active: boolean;
};

type StudentCredential = {
  id: string;
  organizationId: string;
  customerId: string;
  walletAccountId: string | null;
  credentialType: string;
  credentialLabel: string | null;
  active: boolean;
  issuedAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  metadata: Record<string, unknown>;
  customerName: string;
  externalStudentId: string | null;
  externalId: string | null;
  walletBalanceCents: number | null;
  walletCreditLimitCents: number | null;
};

type IssueResponse = {
  credential: StudentCredential;
  credentialToken: string;
  customer: Customer;
  wallet: Wallet;
};

const credentialTypes = [
  { value: "nfc_wristband", label: "NFC wristband" },
  { value: "nfc_card", label: "NFC card" },
  { value: "barcode", label: "Barcode fallback" },
  { value: "qr_code", label: "QR fallback" }
] as const;

export function StaffClient({ initialDemo }: { initialDemo: DemoSchoolData | null }) {
  const [demo, setDemo] = useState<DemoSchoolData | null>(initialDemo);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [credentials, setCredentials] = useState<StudentCredential[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [credentialType, setCredentialType] = useState<(typeof credentialTypes)[number]["value"]>(
    "nfc_wristband"
  );
  const [credentialLabel, setCredentialLabel] = useState("");
  const [credentialToken, setCredentialToken] = useState("");
  const [issuedToken, setIssuedToken] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [issuing, setIssuing] = useState(false);
  const [revokingId, setRevokingId] = useState("");

  async function loadData() {
    setLoading(true);
    setMessage(null);
    try {
      const organization = initialDemo?.organization || (await loadCurrentOrganization());
      const store = initialDemo?.store || (await loadCurrentStore(organization.id));
      const seeded = initialDemo || { organization, store, products: [], students: [] };
      const customersData = await apiGet<Customer[]>(
        `/customers?organizationId=${seeded.organization.id}`
      );
      const credentialData = await apiGet<StudentCredential[]>(
        `/student-credentials?organizationId=${seeded.organization.id}`
      );

      setDemo(seeded);
      setCustomers(customersData);
      setCredentials(credentialData);
      setSelectedCustomerId((current) => current || customersData[0]?.id || "");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not load credential setup");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, [initialDemo]);

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === selectedCustomerId) || null,
    [customers, selectedCustomerId]
  );

  const selectedCustomerCredentials = useMemo(
    () => credentials.filter((credential) => credential.customerId === selectedCustomerId),
    [credentials, selectedCustomerId]
  );

  async function issueCredential() {
    if (!demo || !selectedCustomer) return;

    setIssuing(true);
    setMessage(null);
    try {
      const result = await apiPost<IssueResponse>("/student-credentials/issue", {
        organizationId: demo.organization.id,
        customerId: selectedCustomer.id,
        credentialType,
        credentialLabel: credentialLabel.trim() || undefined,
        credentialToken: credentialToken.trim() || undefined
      });

      setCredentials((current) => [result.credential, ...current]);
      setIssuedToken(result.credentialToken);
      setMessage(
        `${result.credential.credentialType.replaceAll("_", " ")} issued for ${selectedCustomer.name || "student"}.`
      );
      setCredentialLabel("");
      setCredentialToken("");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not issue credential");
    } finally {
      setIssuing(false);
    }
  }

  async function revokeCredential(credential: StudentCredential) {
    if (!demo) return;

    setRevokingId(credential.id);
    setMessage(null);
    try {
      const updated = await apiPost<StudentCredential>(`/student-credentials/${credential.id}/revoke`, {
        organizationId: demo.organization.id
      });
      setCredentials((current) =>
        current.map((item) => (item.id === updated.id ? updated : item))
      );
      setMessage(`Credential ${updated.credentialLabel || updated.id.slice(0, 8)} revoked.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not revoke credential");
    } finally {
      setRevokingId("");
    }
  }

  return (
    <section className="module">
      <PageHeader eyebrow="Admin" title="Cash Register Employees & Credentials">
        <button type="button" onClick={loadData} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </PageHeader>

      <div className="permissionStrip">
        <div>
          <span>Super admin</span>
          <strong>Morgan Chen</strong>
          <small>Can configure all locations, registers, staff roles, inventory rules, and reports.</small>
        </div>
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
          <small>Can manage settings, roles, integrations, credentials, and reports.</small>
        </div>
      </div>

      {message ? (
        <p className="demoError" role="status">
          {message}
        </p>
      ) : null}

      <div className="adminGrid">
        <div className="adminCard">
          <h3>Issue credential</h3>
          <p>
            Staff can create a new NFC card, wristband, QR, or barcode credential for the selected student.
          </p>
          <div className="fieldStack">
            <span>Student</span>
            <select value={selectedCustomerId} onChange={(event) => setSelectedCustomerId(event.target.value)}>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name || "Unnamed student"} {customer.externalId ? `- ${customer.externalId}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="fieldStack">
            <span>Credential type</span>
            <select value={credentialType} onChange={(event) => setCredentialType(event.target.value as (typeof credentialTypes)[number]["value"])}>
              {credentialTypes.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>
          <div className="fieldStack">
            <span>Label</span>
            <input
              value={credentialLabel}
              onChange={(event) => setCredentialLabel(event.target.value)}
              placeholder="Blue band, card 04, lunch line badge"
            />
          </div>
          <div className="fieldStack">
            <span>Optional token</span>
            <input
              value={credentialToken}
              onChange={(event) => setCredentialToken(event.target.value)}
              placeholder="Leave blank to auto-generate"
            />
          </div>
          <button type="button" className="primaryAction" onClick={issueCredential} disabled={!selectedCustomerId || issuing}>
            {issuing ? "Issuing..." : "Issue credential"}
          </button>
          {issuedToken ? (
            <div className="credentialTokenBox">
              <span>Write this token to the card or wristband</span>
              <strong>{issuedToken}</strong>
              <small>The token is what the register reads when the student taps.</small>
            </div>
          ) : null}
          {selectedCustomer ? (
            <p className="walletNote">
              This creates the credential mapping only. The student record and wallet stay in Commerce POS.
            </p>
          ) : null}
        </div>

        <div className="adminCard">
          <h3>Issued credentials</h3>
          <p>Revoke a lost card or bracelet and issue a replacement.</p>
          {selectedCustomerCredentials.length === 0 ? (
            <p className="emptyState">No credentials issued for this student yet.</p>
          ) : (
            <div className="credentialList">
              {selectedCustomerCredentials.map((credential) => (
                <div className="credentialRow" key={credential.id}>
                  <div>
                    <strong>{credential.credentialLabel || credential.credentialType.replaceAll("_", " ")}</strong>
                    <span>{credential.active ? "Active" : "Revoked"}</span>
                    <small>
                      {credential.externalId || credential.externalStudentId || "No student ID"}{" "}
                      {credential.lastUsedAt ? `- Last used ${new Date(credential.lastUsedAt).toLocaleString()}` : ""}
                    </small>
                  </div>
                  <div>
                    <small>{credential.walletBalanceCents !== null ? formatMoney(credential.walletBalanceCents) : "No wallet"}</small>
                    {credential.active ? (
                      <button
                        type="button"
                        onClick={() => void revokeCredential(credential)}
                        disabled={revokingId === credential.id}
                      >
                        {revokingId === credential.id ? "Revoking..." : "Revoke"}
                      </button>
                    ) : (
                      <span className="badge danger">Revoked</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Issued</th>
                </tr>
              </thead>
              <tbody>
                {credentials.map((credential) => (
                  <tr key={credential.id}>
                    <td>{credential.customerName}</td>
                    <td>{credential.credentialType.replaceAll("_", " ")}</td>
                    <td>{credential.active ? "Active" : "Revoked"}</td>
                    <td>{new Date(credential.issuedAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="walletNote">
            If a vendor pre-encodes cards or bands, paste the token into the optional token field before issuing.
          </p>
        </div>
      </div>
    </section>
  );
}
