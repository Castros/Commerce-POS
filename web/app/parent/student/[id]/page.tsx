import { Suspense } from "react";
import StudentDetailClient from "./StudentDetailClient";

export const metadata = { title: "Portal para Padres — Alumno" };

export default function ParentStudentPage() {
  return (
    <Suspense>
      <StudentDetailClient />
    </Suspense>
  );
}
