import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @cbm/shared ships TS/ESM source consumed directly.
  transpilePackages: ["@cbm/shared"],
  output: "standalone",
  serverExternalPackages: ["pg", "ssh2", "ssh2-sftp-client", "@aws-sdk/client-s3"],
};

export default nextConfig;
