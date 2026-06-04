"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { apiGet, apiPost } from "../lib/api";

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
  session: {
    expiresAt: string;
  };
};

function BrandIcon() {
  return (
    <span className="material-symbols-outlined fill" aria-hidden="true">
      local_cafe
    </span>
  );
}

const pinPadKeys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "backspace"];
const pinSlots = Array.from({ length: 4 }, (_, index) => index);

export function LoginClient({
  nextPath,
  cashierMode = false
}: {
  nextPath: string;
  cashierMode?: boolean;
}) {
  const router = useRouter();
  const pinInputRef = useRef<HTMLInputElement | null>(null);
  const [orgQuery, setOrgQuery] = useState("");
  const [orgResults, setOrgResults] = useState<OrgOption[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<OrgOption | null>(null);
  const [searchingOrgs, setSearchingOrgs] = useState(false);
  const [staffOptions, setStaffOptions] = useState<LoginOption[]>([]);
  const [identifier, setIdentifier] = useState("");
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiGet("/auth/me")
      .then(() => {
        if (!cancelled) {
          router.replace(nextPath);
        }
      })
      .catch(() => null);

    return () => {
      cancelled = true;
    };
  }, [nextPath, router]);

  useEffect(() => {
    if (selectedOrg) return;
    const q = orgQuery.trim();
    if (!q) {
      setOrgResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setSearchingOrgs(true);
      try {
        const results = await apiGet<OrgOption[]>(`/auth/orgs?q=${encodeURIComponent(q)}`);
        setOrgResults(results);
      } catch {
        setOrgResults([]);
      } finally {
        setSearchingOrgs(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [orgQuery, selectedOrg]);

  useEffect(() => {
    if (!selectedOrg || cashierMode) return;

    let cancelled = false;
    setLoadingOptions(true);
    apiGet<LoginOption[]>(`/auth/options?organizationId=${selectedOrg.id}`)
      .then((options) => {
        if (!cancelled) {
          setStaffOptions(options);
          setIdentifier(options[0]?.email || options[0]?.name || "");
        }
      })
      .catch(() => {
        if (!cancelled) setStaffOptions([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingOptions(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedOrg, cashierMode]);

  useEffect(() => {
    if (!cashierMode || !selectedOrg) return;

    pinInputRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        pressPinKey(event.key);
        return;
      }
      if (event.key === "Backspace") {
        event.preventDefault();
        pressPinKey("backspace");
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        pressPinKey("clear");
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cashierMode, selectedOrg]);

  const selectedStaff = useMemo(
    () =>
      staffOptions.find(
        (staff) =>
          staff.email === identifier || staff.name === identifier || staff.id === identifier
      ) || null,
    [identifier, staffOptions]
  );

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoggingIn(true);
    setMessage(null);
    try {
      await apiPost<LoginResponse>("/auth/login", {
        organizationId: selectedOrg?.id ?? null,
        identifier: cashierMode ? undefined : identifier.trim() || undefined,
        pin: pin.trim()
      });
      router.replace(nextPath);
      router.refresh();
    } catch (error) {
      setMessage(
        cashierMode
          ? "PIN not recognized. Try again."
          : error instanceof Error
            ? error.message
            : "Could not sign in"
      );
      if (cashierMode) {
        setPin("");
        pinInputRef.current?.focus();
      }
    } finally {
      setLoggingIn(false);
    }
  }

  function pressPinKey(key: string) {
    if (key === "clear") {
      setPin("");
      return;
    }
    if (key === "backspace") {
      setPin((current) => current.slice(0, -1));
      return;
    }
    setPin((current) => (current.length >= 8 ? current : `${current}${key}`));
  }

  function clearOrg() {
    setSelectedOrg(null);
    setStaffOptions([]);
    setIdentifier("");
    setPin("");
    setMessage(null);
  }

  if (!selectedOrg) {
    return (
      <div className={`loginLayout${cashierMode ? " cashierLoginLayout" : ""}`}>
        <section className={`loginPanel${cashierMode ? " cashierLoginPanel" : ""}`}>
          <div className="loginBrand">
            <span className="brandMark">
              <BrandIcon />
            </span>
            <div>
              <strong>Commerce POS</strong>
              <span>Find your school or store</span>
            </div>
          </div>

          <h1>Select your organization</h1>
          <p>Type your school or store name to get started.</p>

          <div className="loginOrgSearch">
            <label className="fieldStack">
              <span>School or store name</span>
              <input
                autoFocus
                value={orgQuery}
                onChange={(e) => setOrgQuery(e.target.value)}
                placeholder="Lincoln Elementary, Main Cafeteria..."
              />
            </label>

            {searchingOrgs ? (
              <p className="loginHint">Searching...</p>
            ) : orgQuery.trim() && orgResults.length === 0 ? (
              <p className="loginHint">No matching organizations found.</p>
            ) : orgResults.length > 0 ? (
              <ul className="loginOrgResults" role="listbox" aria-label="Organizations">
                {orgResults.map((org) => (
                  <li key={org.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected="false"
                      onClick={() => {
                        setSelectedOrg(org);
                        setOrgQuery("");
                        setOrgResults([]);
                      }}
                    >
                      <strong>{org.name}</strong>
                      <span>{org.type.replace(/_/g, " ")}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className={`loginLayout${cashierMode ? " cashierLoginLayout" : ""}`}>
      <section className={`loginPanel${cashierMode ? " cashierLoginPanel" : ""}`}>
        <div className="loginBrand">
          <span className="brandMark">
            <BrandIcon />
          </span>
          <div>
            <strong>Commerce POS</strong>
            <span>{cashierMode ? "Register portal" : "Staff sign in"}</span>
          </div>
        </div>

        <div className="loginOrgContext">
          <span className="material-symbols-outlined" aria-hidden="true">
            location_on
          </span>
          <strong>{selectedOrg.name}</strong>
          <button type="button" className="loginOrgChange" onClick={clearOrg}>
            Change
          </button>
        </div>

        <h1>{cashierMode ? "Open the register" : "Sign in with your staff PIN"}</h1>
        <p>
          {cashierMode
            ? "Enter your cashier PIN to start a register session."
            : "Enter your staff name or email and PIN."}
        </p>

        {message ? (
          <p className="demoError" role={cashierMode ? "alert" : "status"}>
            {message}
          </p>
        ) : null}

        <form className="loginForm" onSubmit={handleLogin}>
          {!cashierMode ? (
            <label className="fieldStack">
              <span>Staff name or email</span>
              <input
                list="staff-options"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder="Staff name or email"
                disabled={loadingOptions}
              />
            </label>
          ) : null}

          {cashierMode ? (
            <div className="cashierPinField">
              <span>Cashier PIN</span>
              <button
                type="button"
                className="cashierPinDisplay"
                onClick={() => pinInputRef.current?.focus()}
                aria-label={`Cashier PIN entry. ${pin.length} digits entered.`}
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
                onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 8))}
                inputMode="numeric"
                autoComplete="one-time-code"
                aria-label="Cashier PIN"
              />
            </div>
          ) : (
            <label className="fieldStack">
              <span>PIN</span>
              <input
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 8))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="••••"
              />
            </label>
          )}

          {cashierMode ? (
            <div className="pinPad" role="group" aria-label="Cashier PIN keypad">
              {pinPadKeys.map((key) => (
                <button
                  type="button"
                  key={key}
                  className={key === "clear" || key === "backspace" ? "pinPadUtility" : ""}
                  onClick={() => pressPinKey(key)}
                  aria-label={
                    key === "backspace"
                      ? "Delete last digit"
                      : key === "clear"
                        ? "Clear PIN"
                        : `Digit ${key}`
                  }
                >
                  {key === "backspace" ? (
                    <span className="material-symbols-outlined" aria-hidden="true">
                      backspace
                    </span>
                  ) : key === "clear" ? (
                    "Clear"
                  ) : (
                    key
                  )}
                </button>
              ))}
            </div>
          ) : null}

          <button className={cashierMode ? "pinSubmit" : ""} type="submit" disabled={loggingIn}>
            {loggingIn
              ? "Signing in..."
              : cashierMode
                ? "Open cashier register"
                : "Open workspace"}
          </button>
        </form>

        {!cashierMode ? (
          <datalist id="staff-options">
            {staffOptions.map((staff) => (
              <option key={staff.id} value={staff.email || staff.name || staff.id}>
                {staff.role}
              </option>
            ))}
          </datalist>
        ) : null}

        <div className="loginChips">
          {!cashierMode ? (
            <>
              {selectedStaff ? <span>{selectedStaff.role.replaceAll("_", " ")}</span> : null}
              <Link href="/register-login">Cashier PIN login</Link>
            </>
          ) : (
            <>
              <span>PIN only</span>
              <Link href="/login">Manager/admin sign in</Link>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
