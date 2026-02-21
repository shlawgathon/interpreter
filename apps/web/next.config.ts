import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@interpreter/shared"],
};

export default nextConfig;
