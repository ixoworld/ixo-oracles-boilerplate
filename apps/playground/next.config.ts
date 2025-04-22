import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /* config options here */

  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
      path: false,
      zlib: false,
      http: false,
      https: false,
      stream: false,
      crypto: false,
      os: false,
      util: false,
      'node:util': false,
    };

    return config;
  },
};

export default nextConfig;
