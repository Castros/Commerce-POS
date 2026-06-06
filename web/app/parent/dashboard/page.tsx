import { Suspense } from "react";
import DashboardClient from "./DashboardClient";

export const metadata = { title: "Portal para Padres" };

export default function ParentDashboardPage() {
  return (
    <Suspense>
      <DashboardClient />
    </Suspense>
  );
}
