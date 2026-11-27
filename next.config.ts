import { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const config: NextConfig = {
  serverExternalPackages: ["@everruns/bashkit", "gl", "quickjs-emscripten"],
  poweredByHeader: false,
  agentRules: false,
  turbopack: {
    resolveAlias: {
      // msw's ./browser export has "node": null, which breaks the server-side
      // compile of client components importing the worker. Alias to the real
      // module so both the client and SSR graphs can resolve it.
      "msw/browser": "./node_modules/msw/lib/browser/index.js",
    },
  },
};

export default withNextIntl(config);
