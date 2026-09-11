import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    '192.168.11.20',
    '127.0.0.1',
    'localhost',
  ],
};

export default nextConfig;
