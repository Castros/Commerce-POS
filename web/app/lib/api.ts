export type ApiEnvelope<T> = {
  data: T;
};

async function readApiPayload<T>(response: Response): Promise<ApiEnvelope<T>> {
  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    const text = await response.text();
    const message = text.startsWith("<!DOCTYPE")
      ? "API returned an HTML page. Check that the API route exists and the dev proxy is running."
      : text.slice(0, 180) || "Request failed";
    throw new Error(message);
  }

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }

  return payload as ApiEnvelope<T>;
}

export async function apiGet<T>(path: string, options?: { signal?: AbortSignal }): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    cache: "no-store",
    credentials: "include",
    signal: options?.signal,
  });
  const payload = await readApiPayload<T>(response);
  return (payload as ApiEnvelope<T>).data;
}

export async function apiPost<T>(
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers
    },
    credentials: "include",
    body: JSON.stringify(body)
  });
  const payload = await readApiPayload<T>(response);
  return (payload as ApiEnvelope<T>).data;
}

export async function apiPut<T>(
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      ...headers
    },
    credentials: "include",
    body: JSON.stringify(body)
  });
  const payload = await readApiPayload<T>(response);
  return (payload as ApiEnvelope<T>).data;
}

export async function apiPatch<T>(
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...headers
    },
    credentials: "include",
    body: JSON.stringify(body)
  });
  const payload = await readApiPayload<T>(response);
  return (payload as ApiEnvelope<T>).data;
}
