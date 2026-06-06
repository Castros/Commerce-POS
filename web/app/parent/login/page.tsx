import { Suspense } from "react";
import ParentLoginClient from "./ParentLoginClient";

export const metadata = { title: "Portal para Padres — Acceso" };

export default function ParentLoginPage() {
  return (
    <Suspense>
      <ParentLoginClient />
    </Suspense>
  );
}
