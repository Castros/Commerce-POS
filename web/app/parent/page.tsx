"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function RedirectHandler() {
  const router = useRouter();
  const params = useSearchParams();
  const org = params.get("org");

  useEffect(() => {
    if (org) {
      router.replace(`/parent/dashboard?org=${org}`);
    } else {
      router.replace("/parent/login");
    }
  }, [org, router]);

  return null;
}

export default function ParentRoot() {
  return (
    <Suspense>
      <RedirectHandler />
    </Suspense>
  );
}
