/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // unpdf bundles PDF.js, which reads its own worker and font files off disk
    // at runtime. Bundling it breaks those lookups, so it is loaded from
    // node_modules as a plain external instead — it is only ever imported on
    // the server, by lib/invoice/extract.ts.
    serverComponentsExternalPackages: ["unpdf"],
  },
};

export default nextConfig;
