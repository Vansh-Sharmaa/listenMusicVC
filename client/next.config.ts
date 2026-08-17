import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  // Allow Next.js to bind to Railway's dynamic PORT
  ...(process.env.PORT ? { env: { PORT: process.env.PORT } } : {}),
};

export default nextConfig;
