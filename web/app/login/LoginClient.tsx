"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { apiGet, apiPost } from "../lib/api";
import { saveRegisterStore } from "../lib/organizationContext";
import type { Store } from "../lib/demoTypes";

type OrgOption = {
  id: string;
  name: string;
  type: string;
};

type LoginOption = {
  id: string;
  organizationId: string;
  email: string | null;
  name: string | null;
  role: string;
  active: boolean;
  pinLast4: string | null;
  displayName: string;
};

type LoginResponse = {
  user: {
    id: string;
    organizationId: string;
    email: string | null;
    name: string | null;
    role: string;
    active: boolean;
    storeIds: string[];
  };
  session: { expiresAt: string };
};

function BrandIcon() {
  return (
    <span className="material-symbols-outlined fill" aria-hidden="true">
      local_cafe
    </span>
  );
}

const ROLE_COLORS: Record<string, string> = {
  cashier: "var(--primary)",
  store_manager: "#d97706",
  organization_admin: "#15803d",
  organization_owner: "#15803d",
  admin: "#15803d",
  manager: "#d97706",
  super_admin: "#7c3aed",
  platform_admin: "#7c3aed"
};

const ROLE_LABELS: Record<string, string> = {
  cashier: "Cashier",
  store_manager: "Manager",
  organization_admin: "Admin",
  organization_owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  super_admin: "Super Admin",
  platform_admin: "Platform"
};

function StaffAvatar({
  name,
  role,
  size = 56
}: {
  name: string;
  role: string;
  size?: number;
}) {
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0] || "")
    .join("")
    .toUpperCase();
  const color = ROLE_COLORS[role] || "#6b7280";

  return (
    <div
      className="staffAvatar"
      style={{ width: size, height: size, background: color, fontSize: size * 0.33 }}
      aria-hidden="true"
    >
      {initials}
    </div>
  );
}

const pinPadKeys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "backspace"];
const pinSlots = Array.from({ length: 4 }, (_, i) => i);

// ── Org search screen (shared between cashier and admin modes) ────────────────

function OrgSearchScreen({
  cashierMode,
  onSelect
}: {
  cashierMode: boolean;
  onSelect: (org: OrgOption) => void;
}) {
  const [orgQuery, setOrgQuery] = useState("");
  const [orgResults, setOrgResults] = useState<OrgOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = orgQuery.trim();
    if (!q) return;
    setSearching(true);
    setSearched(true);
    try {
      const results = await apiGet<OrgOption[]>(`/auth/orgs?q=${encodeURIComponent(q)}`);
      setOrgResults(results);
    } catch {
      setOrgResults([]);
    } finally {
      setSearching(false);
    }
  }

  return (
    <>
      <h1>Select your organization</h1>
      <p>Enter your school or store name to get started.</p>
      <form className="loginOrgSearch" onSubmit={(e) => void handleSearch(e)}>
        <label className="fieldStack">
          <span>School or store name</span>
          <input
            autoFocus
            value={orgQuery}
            onChange={(e) => { setOrgQuery(e.target.value); setSearched(false); setOrgResults([]); }}
            placeholder="Lincoln Elementary, Main Cafeteria..."
          />
        </label>
        <button type="submit" disabled={searching || !orgQuery.trim()}>
          {searching ? "Searching…" : "Find Organization"}
        </button>
        {searched && !searching && orgResults.length === 0 ? (
          <p className="loginHint">No matching organizations found.</p>
        ) : orgResults.length > 0 ? (
          <ul className="loginOrgResults" role="listbox" aria-label="Organizations">
            {orgResults.map((org) => (
              <li key={org.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected="false"
                  onClick={() => onSelect(org)}
                >
                  <strong>{org.name}</strong>
                  <span>{org.type.replace(/_/g, " ")}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </form>
      {!cashierMode && (
        <div className="loginChips">
          <Link href="/register-login">Cashier PIN login</Link>
        </div>
      )}
    </>
  );
}

// ── Staff grid screen ─────────────────────────────────────────────────────────

function StaffGridScreen({
  org,
  onSelect,
  onChangeOrg
}: {
  org: OrgOption;
  onSelect: (staff: LoginOption) => void;
  onChangeOrg: () => void;
}) {
  const [staff, setStaff] = useState<LoginOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    apiGet<LoginOption[]>(`/auth/options?organizationId=${org.id}`)
      .then(setStaff)
      .catch(() => setStaff([]))
      .finally(() => setLoading(false));
  }, [org.id]);

  const filtered = useMemo(() => {
    if (!search.trim()) return staff;
    const q = search.trim().toLowerCase();
    return staff.filter((s) => s.displayName.toLowerCase().includes(q));
  }, [staff, search]);

  return (
    <>
      <div className="loginOrgContext">
        <span className="material-symbols-outlined" aria-hidden="true">location_on</span>
        <strong>{org.name}</strong>
        <button type="button" className="loginOrgChange" onClick={onChangeOrg}>Change</button>
      </div>

      <h1>Who are you?</h1>
      <p>Tap your name to sign in.</p>

      {loading ? (
        <p className="loginHint">Loading staff…</p>
      ) : staff.length === 0 ? (
        <p className="loginHint">No staff accounts found for this organization.</p>
      ) : (
        <>
          {staff.length > 8 && (
            <input
              className="staffSearchInput"
              placeholder="Search your name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          )}
          <div className="staffGrid">
            {filtered.map((member) => (
              <button
                key={member.id}
                type="button"
                className="staffTile"
                onClick={() => onSelect(member)}
              >
                <StaffAvatar name={member.displayName} role={member.role} size={64} />
                <span className="staffTileName">{member.displayName}</span>
                <span
                  className="staffTileRole"
                  style={{ background: `${ROLE_COLORS[member.role] || "#6b7280"}22`, color: ROLE_COLORS[member.role] || "#6b7280" }}
                >
                  {ROLE_LABELS[member.role] || member.role}
                </span>
              </button>
            ))}
          </div>
          {filtered.length === 0 && search && (
            <p className="loginHint">No staff match "{search}"</p>
          )}
        </>
      )}

      <div className="loginChips">
        <Link href="/login">Manager / admin sign in</Link>
      </div>
    </>
  );
}

// ── PIN entry screen ──────────────────────────────────────────────────────────

function PinScreen({
  org,
  member,
  onBack,
  onSuccess
}: {
  org: OrgOption;
  member: LoginOption;
  onBack: () => void;
  onSuccess: (response: LoginResponse) => void;
}) {
  const pinInputRef = useRef<HTMLInputElement>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [shake, setShake] = useState(false);

  useEffect(() => {
    pinInputRef.current?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (/^\d$/.test(e.key)) { e.preventDefault(); pressKey(e.key); return; }
      if (e.key === "Backspace") { e.preventDefault(); pressKey("backspace"); return; }
      if (e.key === "Escape") { e.preventDefault(); onBack(); }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pressKey(key: string) {
    if (key === "clear") { setPin(""); return; }
    if (key === "backspace") { setPin((p) => p.slice(0, -1)); return; }
    setPin((p) => (p.length >= 8 ? p : `${p}${key}`));
  }

  async function submit(pinValue: string) {
    if (loggingIn || pinValue.length < 1) return;
    setLoggingIn(true);
    setError(null);
    try {
      const response = await apiPost<LoginResponse>("/auth/login", {
        organizationId: org.id,
        identifier: member.email || member.name,
        pin: pinValue
      });
      onSuccess(response);
    } catch {
      setError("Incorrect PIN. Try again.");
      setShake(true);
      setPin("");
      setTimeout(() => setShake(false), 500);
      pinInputRef.current?.focus();
    } finally {
      setLoggingIn(false);
    }
  }

  // Auto-submit at 4 digits
  useEffect(() => {
    if (pin.length === 4) void submit(pin);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  return (
    <>
      <div className="loginOrgContext">
        <span className="material-symbols-outlined" aria-hidden="true">location_on</span>
        <strong>{org.name}</strong>
      </div>

      <div className="pinWho">
        <StaffAvatar name={member.displayName} role={member.role} size={72} />
        <div>
          <strong>{member.displayName}</strong>
          <span style={{ color: ROLE_COLORS[member.role] || "#6b7280" }}>
            {ROLE_LABELS[member.role] || member.role}
          </span>
        </div>
      </div>

      <h1>Enter your PIN</h1>

      {error && (
        <p className="demoError" role="alert">{error}</p>
      )}

      <div className={`cashierPinField${shake ? " pinShake" : ""}`}>
        <button
          type="button"
          className="cashierPinDisplay"
          onClick={() => pinInputRef.current?.focus()}
          aria-label={`PIN entry. ${pin.length} digits entered.`}
        >
          {pinSlots.map((slot) => (
            <span
              key={slot}
              className={`pinSlot${pin.length > slot ? " filled" : ""}`}
              aria-hidden="true"
            />
          ))}
        </button>
        <input
          ref={pinInputRef}
          className="cashierPinInput"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label="PIN"
        />
      </div>

      <div className="pinPad" role="group" aria-label="PIN keypad">
        {pinPadKeys.map((key) => (
          <button
            type="button"
            key={key}
            className={key === "clear" || key === "backspace" ? "pinPadUtility" : ""}
            onClick={() => pressKey(key)}
            disabled={loggingIn}
            aria-label={
              key === "backspace" ? "Delete last digit" : key === "clear" ? "Clear PIN" : `Digit ${key}`
            }
          >
            {key === "backspace" ? (
              <span className="material-symbols-outlined" aria-hidden="true">backspace</span>
            ) : key === "clear" ? "Clear" : key}
          </button>
        ))}
      </div>

      <div className="loginChips">
        <button type="button" className="loginChipBtn" onClick={onBack}>
          ← Not you?
        </button>
      </div>
    </>
  );
}

// ── Store picker screen (post-login) ─────────────────────────────────────────

function StorePickerScreen({
  loginResponse,
  onSelect
}: {
  loginResponse: LoginResponse;
  onSelect: (store: Store) => void;
}) {
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);

  const storeTypeIcon: Record<string, string> = {
    cafeteria: "restaurant",
    bookstore: "menu_book",
    uniform: "checkroom",
    general: "store"
  };

  useEffect(() => {
    apiGet<Store[]>(`/stores?organizationId=${loginResponse.user.organizationId}`)
      .then((all) => {
        const { storeIds } = loginResponse.user;
        // Admins/super-admins: show all stores; cashiers/managers: filter to assigned stores
        const restricted = ["cashier", "store_manager", "manager"].includes(loginResponse.user.role ?? "");
        const visible = restricted && storeIds.length > 0
          ? all.filter((s) => storeIds.includes(s.id))
          : all;
        setStores(visible);
        // Auto-select if only one option
        if (visible.length === 1) {
          saveRegisterStore(visible[0]);
          onSelect(visible[0]);
        }
      })
      .catch(() => setStores([]))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <p className="loginHint">Loading cafeterias…</p>;

  return (
    <>
      <h1>Which cafeteria today?</h1>
      <p>Select the location you're working at for this session.</p>
      <div className="storePickerGrid">
        {stores.map((store) => (
          <button
            key={store.id}
            type="button"
            className="storePickerTile"
            onClick={() => {
              saveRegisterStore(store);
              onSelect(store);
            }}
          >
            <span className="material-symbols-outlined storePickerIcon" aria-hidden="true">
              {storeTypeIcon[store.type] || "store"}
            </span>
            <strong>{store.name}</strong>
            <span>{store.type.replace(/_/g, " ")}</span>
          </button>
        ))}
      </div>
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function LoginClient({
  nextPath,
  cashierMode = false
}: {
  nextPath: string;
  cashierMode?: boolean;
}) {
  const router = useRouter();

  // Cashier-mode multi-step state
  const [cashierStep, setCashierStep] = useState<"org" | "staff" | "pin" | "store">("org");
  const [selectedOrg, setSelectedOrg] = useState<OrgOption | null>(null);
  const [selectedMember, setSelectedMember] = useState<LoginOption | null>(null);
  const [loginResponse, setLoginResponse] = useState<LoginResponse | null>(null);

  // On mount, restore the last-used org so locking returns to staff grid
  useEffect(() => {
    if (!cashierMode) return;
    try {
      const saved = localStorage.getItem("commerce_pos_register_org");
      if (saved) {
        const org = JSON.parse(saved) as OrgOption;
        setSelectedOrg(org);
        setCashierStep("staff");
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Admin/workspace mode state (unchanged)
  const [orgQuery, setOrgQuery] = useState("");
  const [orgResults, setOrgResults] = useState<OrgOption[]>([]);
  const [adminOrg, setAdminOrg] = useState<OrgOption | null>(null);
  const [searchingOrgs, setSearchingOrgs] = useState(false);
  const [staffOptions, setStaffOptions] = useState<LoginOption[]>([]);
  const [identifier, setIdentifier] = useState("");
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [adminOrgSearched, setAdminOrgSearched] = useState(false);

  // Redirect if already logged in
  useEffect(() => {
    let cancelled = false;
    apiGet("/auth/me")
      .then(() => { if (!cancelled) router.replace(nextPath); })
      .catch(() => null);
    return () => { cancelled = true; };
  }, [nextPath, router]);

  // ── Admin mode: org search (explicit submit only)
  async function handleAdminOrgSearch(e: React.FormEvent) {
    e.preventDefault();
    if (cashierMode || adminOrg) return;
    const q = orgQuery.trim();
    if (!q) return;
    setSearchingOrgs(true);
    setAdminOrgSearched(true);
    try {
      const results = await apiGet<OrgOption[]>(`/auth/orgs?q=${encodeURIComponent(q)}`);
      setOrgResults(results);
    } catch { setOrgResults([]); }
    finally { setSearchingOrgs(false); }
  }

  // ── Admin mode: load staff options when org selected
  useEffect(() => {
    if (cashierMode || !adminOrg) return;
    let cancelled = false;
    setLoadingOptions(true);
    apiGet<LoginOption[]>(`/auth/options?organizationId=${adminOrg.id}`)
      .then((opts) => {
        if (!cancelled) {
          setStaffOptions(opts);
        }
      })
      .catch(() => { if (!cancelled) setStaffOptions([]); })
      .finally(() => { if (!cancelled) setLoadingOptions(false); });
    return () => { cancelled = true; };
  }, [adminOrg, cashierMode]);

  const selectedStaff = useMemo(
    () => staffOptions.find((s) => s.email === identifier || s.name === identifier || s.id === identifier) || null,
    [identifier, staffOptions]
  );

  async function handleAdminLogin(e: FormEvent) {
    e.preventDefault();
    setLoggingIn(true);
    setMessage(null);
    try {
      await apiPost<LoginResponse>("/auth/login", {
        organizationId: adminOrg?.id ?? null,
        identifier: identifier.trim() || undefined,
        pin: pin.trim()
      });
      router.replace(nextPath);
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not sign in");
    } finally {
      setLoggingIn(false);
    }
  }

  // ── Cashier mode flow ─────────────────────────────────────────────────────

  if (cashierMode) {
    return (
      <div className="loginLayout cashierLoginLayout">
        <section className="loginPanel cashierLoginPanel">
          <div className="loginBrand">
            <span className="brandMark"><BrandIcon /></span>
            <div>
              <strong>Commerce POS</strong>
              <span>Cashier register</span>
            </div>
          </div>

          {cashierStep === "org" && (
            <OrgSearchScreen
              cashierMode
              onSelect={(org) => {
                try { localStorage.setItem("commerce_pos_register_org", JSON.stringify(org)); } catch {}
                setSelectedOrg(org);
                setCashierStep("staff");
              }}
            />
          )}

          {cashierStep === "staff" && selectedOrg && (
            <StaffGridScreen
              org={selectedOrg}
              onSelect={(member) => {
                setSelectedMember(member);
                setCashierStep("pin");
              }}
              onChangeOrg={() => {
                try { localStorage.removeItem("commerce_pos_register_org"); } catch {}
                setSelectedOrg(null);
                setSelectedMember(null);
                setCashierStep("org");
              }}
            />
          )}

          {cashierStep === "pin" && selectedOrg && selectedMember && (
            <div className="pinStepWrap">
              <PinScreen
                org={selectedOrg}
                member={selectedMember}
                onBack={() => setCashierStep("staff")}
                onSuccess={(response) => {
                  setLoginResponse(response);
                  setCashierStep("store");
                }}
              />
            </div>
          )}

          {cashierStep === "store" && loginResponse && (
            <StorePickerScreen
              loginResponse={loginResponse}
              onSelect={() => {
                router.replace(nextPath);
                router.refresh();
              }}
            />
          )}
        </section>
      </div>
    );
  }

  // ── Admin / workspace login (unchanged) ──────────────────────────────────

  if (!adminOrg) {
    return (
      <div className="loginLayout">
        <section className="loginPanel">
          <div className="loginBrand">
            <span className="brandMark"><BrandIcon /></span>
            <div>
              <strong>Commerce POS</strong>
              <span>Find your school or store</span>
            </div>
          </div>
          <h1>Select your organization</h1>
          <p>Enter your school or store name to get started.</p>
          <form className="loginOrgSearch" onSubmit={(e) => void handleAdminOrgSearch(e)}>
            <label className="fieldStack">
              <span>School or store name</span>
              <input
                autoFocus
                value={orgQuery}
                onChange={(e) => { setOrgQuery(e.target.value); setOrgResults([]); setAdminOrgSearched(false); }}
                placeholder="Lincoln Elementary, Main Cafeteria..."
              />
            </label>
            <button type="submit" disabled={searchingOrgs || !orgQuery.trim()}>
              {searchingOrgs ? "Searching..." : "Find Organization"}
            </button>
            {adminOrgSearched && !searchingOrgs && orgResults.length === 0 ? (
              <p className="loginHint">No matching organizations found.</p>
            ) : orgResults.length > 0 ? (
              <ul className="loginOrgResults" role="listbox" aria-label="Organizations">
                {orgResults.map((org) => (
                  <li key={org.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected="false"
                      onClick={() => { setAdminOrg(org); setOrgQuery(""); setOrgResults([]); setAdminOrgSearched(false); }}
                    >
                      <strong>{org.name}</strong>
                      <span>{org.type.replace(/_/g, " ")}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </form>
          <div className="loginChips">
            <Link href="/register-login">Cashier PIN login</Link>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="loginLayout">
      <section className="loginPanel">
        <div className="loginBrand">
          <span className="brandMark"><BrandIcon /></span>
          <div>
            <strong>Commerce POS</strong>
            <span>Staff sign in</span>
          </div>
        </div>

        <div className="loginOrgContext">
          <span className="material-symbols-outlined" aria-hidden="true">location_on</span>
          <strong>{adminOrg.name}</strong>
          <button type="button" className="loginOrgChange" onClick={() => {
            setAdminOrg(null); setStaffOptions([]); setIdentifier(""); setPin(""); setMessage(null);
          }}>
            Change
          </button>
        </div>

        <h1>Sign in with your staff PIN</h1>
        <p>Enter your staff name or email and PIN.</p>

        {message && <p className="demoError" role="status">{message}</p>}

        <form className="loginForm" onSubmit={(e) => void handleAdminLogin(e)}>
          <label className="fieldStack">
            <span>Staff name or email</span>
            <input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="Staff name or email"
              disabled={loadingOptions}
            />
          </label>
          <label className="fieldStack">
            <span>PIN</span>
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="••••"
            />
          </label>
          <button type="submit" disabled={loggingIn}>
            {loggingIn ? "Signing in..." : "Open workspace"}
          </button>
        </form>

        <div className="loginChips">
          {selectedStaff && <span>{selectedStaff.role.replaceAll("_", " ")}</span>}
          <Link href="/register-login">Cashier PIN login</Link>
        </div>
      </section>
    </div>
  );
}
