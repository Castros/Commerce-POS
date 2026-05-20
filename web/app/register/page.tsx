import { RegisterClient } from "./RegisterClient";
import type { DemoSchoolData } from "../lib/demoTypes";

async function getDemoSchool(): Promise<DemoSchoolData | null> {
  try {
    const response = await fetch(`${process.env.API_URL || "http://localhost:4100"}/v1/demo/school`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: "{}",
      cache: "no-store"
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as { data: DemoSchoolData };
    return {
      ...payload.data,
      students: []
    };
  } catch {
    return null;
  }
}

export default async function RegisterPage() {
  const initialDemo = await getDemoSchool();
  return <RegisterClient initialDemo={initialDemo} />;
}
