import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["gl", "quickjs-emscripten"],
  poweredByHeader: false,
  agentRules: false,
};

export default config;
