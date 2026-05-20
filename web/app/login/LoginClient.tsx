"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";

import { apiGet, apiPost } from "../lib/api";

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

export function LoginClient({ nextPath }: { nextPath: string }) {
  const router = useRouter();
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
    let cancelled = false;

    async function loadOptions() {
      setLoadingOptions(true);
      try {
        const options = await apiGet<LoginOption[]>("/auth/options");
        if (!cancelled) {
          setStaffOptions(options);
          setIdentifier((current) => current || options[0]?.email || options[0]?.name || "");
        }
      } catch {
        if (!cancelled) {
          setStaffOptions([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingOptions(false);
        }
      }
    }

    void loadOptions();

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedStaff = useMemo(
    () =>
      staffOptions.find(
        (staff) => staff.email === identifier || staff.name === identifier || staff.id === identifier
      ) || null,
    [identifier, staffOptions]
  );

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoggingIn(true);
    setMessage(null);
    try {
      await apiPost<LoginResponse>("/auth/login", {
        identifier: identifier.trim() || undefined,
        pin: pin.trim()
      });
      router.replace(nextPath);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not sign in");
    } finally {
      setLoggingIn(false);
    }
  }

  return (
    <div className="loginLayout">
      <section className="loginPanel">
        <div className="loginBrand">
          <span className="brandMark">
            <BrandIcon />
          </span>
          <div>
            <strong>Commerce POS</strong>
            <span>Staff sign in</span>
          </div>
        </div>

        <h1>Sign in with your staff PIN</h1>
        <p>
          Use your staff name or email plus PIN to open the register. This keeps cashier access separate from admin access.
        </p>

        {message ? (
          <p className="demoError" role="status">
            {message}
          </p>
        ) : null}

        <form className="loginForm" onSubmit={handleLogin}>
          <label className="fieldStack">
            <span>Staff name or email</span>
            <input
              list="staff-options"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder="jordan.lee@example.test"
            />
          </label>

          <label className="fieldStack">
            <span>PIN</span>
            <input
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="••••"
            />
          </label>

          <button type="submit" disabled={loggingIn}>
            {loggingIn ? "Signing in..." : "Open register"}
          </button>
        </form>

        <datalist id="staff-options">
          {staffOptions.map((staff) => (
            <option key={staff.id} value={staff.email || staff.name || staff.id}>
              {staff.role}
            </option>
          ))}
        </datalist>

        <div className="loginChips">
          <span>{loadingOptions ? "Loading staff list..." : "Demo staff accounts loaded"}</span>
          {selectedStaff ? <span>{selectedStaff.role.replaceAll("_", " ")}</span> : null}
          <Link href="/dashboard">Back to dashboard</Link>
        </div>
      </section>
    </div>
  );
}
