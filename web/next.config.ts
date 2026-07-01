import type { NextConfig } from "next";

const allowedDevOrigins = [
  "192.168.1.30",
  "pos.home.jerrycastro.dev",
  ...(process.env.NEXT_ALLOWED_DEV_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
];

const nextConfig: NextConfig = {
  allowedDevOrigins,
  experimental: {
    turbopackMemoryLimit: 512_000_000,       // 512 MB — aggressively evict to disk cache
    turbopackFileSystemCacheForDev: true,    // persist evicted modules to disk
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
        pathname: "/**",
      },
    ],
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.API_URL || "http://localhost:4100"}/:path*`
      }
    ];
  }
};

export default nextConfig;
