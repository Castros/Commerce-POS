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
  turbopack: {
    root: process.cwd()
  },
  experimental: {
    turbopackMemoryLimit: 1_500_000_000, // 1.5 GB — prevents heap OOM under rapid hot-reload
    turbopackFileSystemCacheForDev: true, // persist module cache to disk so heap can be freed
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
