/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Two dev servers on one checkout must not share a build directory, or they
  // clobber each other's chunks. scripts/dev-mock.mjs sets this to .next-mock.
  distDir: process.env.LEADLINE_DIST || ".next",
};

export default nextConfig;
