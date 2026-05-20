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
