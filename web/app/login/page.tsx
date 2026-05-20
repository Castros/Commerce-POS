import { LoginClient } from "./LoginClient";

export default async function LoginPage({
  searchParams
}: {
  searchParams?: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  const next = params?.next;
  const nextPath = Array.isArray(next) ? next[0] : next || "/dashboard";

  return <LoginClient nextPath={nextPath} />;
}
