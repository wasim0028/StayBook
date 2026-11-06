import type { NextConfig } from "next";

const csp = [
  "default-src 'self'",
  // Razorpay Checkout loads its script and renders inside an iframe it controls.
  "script-src 'self' 'unsafe-inline' https://checkout.razorpay.com" + (process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.amazonaws.com https://lumberjack.razorpay.com https://api.razorpay.com",
  "frame-src https://api.razorpay.com https://checkout.razorpay.com",
  "form-action 'self' https://*.amazonaws.com", // photo uploads POST straight to S3
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join("; ");

const config: NextConfig = {
  output: "standalone",
  // The repo root has its own package-lock (backend workspaces). Pin tracing to this app so
  // .next/standalone/server.js is at the top level, which is what docker/web.Dockerfile copies.
  outputFileTracingRoot: process.cwd(),
  turbopack: { root: process.cwd() },
  poweredByHeader: false,
  reactStrictMode: true,
  images: { unoptimized: true }, // photos are already resized WebP renditions served by CloudFront
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default config;
