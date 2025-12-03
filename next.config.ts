import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    '/api/check': ['./data/**/*'],
  },
};

export default nextConfig;
