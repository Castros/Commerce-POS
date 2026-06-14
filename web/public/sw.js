const CACHE_VERSION = "v1";
const STATIC_CACHE = `pos-static-${CACHE_VERSION}`;
const PAGE_CACHE = `pos-pages-${CACHE_VERSION}`;
const API_CACHE = `pos-api-${CACHE_VERSION}`;

const ALL_CACHES = [STATIC_CACHE, PAGE_CACHE, API_CACHE];

// Pages to pre-cache on install
const PRECACHE_PAGES = ["/register", "/dashboard", "/login"];

// API paths safe to cache (read-only data)
const CACHEABLE_API = [
  "/api/v1/products",
  "/api/v1/product-categories",
  "/api/v1/customers",
  "/api/v1/stores",
  "/api/v1/auth/me",
  "/api/v1/inventory",
];

// API paths that must always hit the network (financial mutations)
const BYPASS_API = [
  "/api/v1/orders/",
  "/api/v1/wallets/",
  "/api/v1/cash-drawers/",
  "/api/v1/auth/login",
  "/api/v1/auth/logout",
  "/api/v1/guardian-portal/auth",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(PAGE_CACHE).then((cache) => cache.addAll(PRECACHE_PAGES)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !ALL_CACHES.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // Immutable Next.js static assets — cache forever
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // Financial mutations — bypass SW entirely, always go to network
  if (BYPASS_API.some((p) => url.pathname.startsWith(p))) {
    return;
  }

  // Cacheable API endpoints — network first, fall back to cache
  if (CACHEABLE_API.some((p) => url.pathname.startsWith(p)) && request.method === "GET") {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  // HTML pages — network first, fall back to cached page shell
  if (request.headers.get("accept")?.includes("text/html")) {
    event.respondWith(networkFirst(request, PAGE_CACHE));
    return;
  }
});

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Offline fallback for API calls
    if (request.url.includes("/api/")) {
      return new Response(JSON.stringify({ error: "Offline" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("Offline", { status: 503 });
  }
}
