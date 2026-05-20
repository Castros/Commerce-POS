import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.1.30"],
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
