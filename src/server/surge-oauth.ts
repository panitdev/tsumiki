import { createRemoteJWKSet, jwtVerify, type JWTVerifyOptions } from "jose";

const requestTimeout = 5000;
const cacheTtl = 300_000;

export function parsePublicUrl(value: string): URL {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.hash || value.includes("#") ||
      (url.protocol !== "https:" && !(loopback && url.protocol === "http:"))) {
    throw new Error("Expected a public HTTPS URL or an HTTP loopback URL.");
  }
  return url;
}

export function surgeIssuerConfig(): string | undefined {
  const value = process.env.TSUMIKI_OAUTH_ISSUER;
  if (value === undefined) return undefined;
  const url = parsePublicUrl(value);
  if (value !== url.origin) throw new Error("Expected TSUMIKI_OAUTH_ISSUER to be a canonical origin.");
  return value;
}

type Metadata = {
  issuer: string;
  jwksUri: URL;
  authorizationEndpoint: URL;
  tokenEndpoint: URL;
  introspectionEndpoint?: URL;
};

let discovery: { issuer: string; expires: number; result: Promise<Metadata> } | undefined;

export async function fetchSurgeJson(url: URL, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(requestTimeout),
  });
  if (!response.ok) throw new Error("Surge OAuth request failed.");
  return response.json();
}

async function discover(issuer: string): Promise<Metadata> {
  const doc = await fetchSurgeJson(new URL("/.well-known/oauth-authorization-server", issuer));
  if (!doc || typeof doc !== "object" || !("issuer" in doc) || doc.issuer !== issuer) {
    throw new Error("Surge OAuth metadata issuer does not match.");
  }
  const metadata = doc as Record<string, unknown>;
  function endpoint(name: string) {
    const value = metadata[name];
    if (typeof value !== "string") throw new Error(`Surge OAuth metadata has no ${name}.`);
    const url = parsePublicUrl(value);
    if (url.origin !== issuer) throw new Error(`Surge OAuth ${name} is outside the issuer origin.`);
    return url;
  }
  return {
    issuer, jwksUri: endpoint("jwks_uri"),
    authorizationEndpoint: endpoint("authorization_endpoint"),
    tokenEndpoint: endpoint("token_endpoint"),
    introspectionEndpoint: metadata.introspection_endpoint === undefined ? undefined : endpoint("introspection_endpoint"),
  };
}

export function loadSurgeMetadata(issuer: string): Promise<Metadata> {
  if (discovery?.issuer === issuer && Date.now() < discovery.expires) return discovery.result;
  const result = discover(issuer);
  discovery = { issuer, expires: Date.now() + cacheTtl, result };
  void result.catch(() => {
    if (discovery?.result === result) discovery = undefined;
  });
  return result;
}

let keys: { url: string; get: ReturnType<typeof createRemoteJWKSet> } | undefined;

export function verifySurgeJwt(issuer: string, jwksUri: URL, token: string, options: JWTVerifyOptions) {
  if (jwksUri.origin !== issuer) throw new Error("Surge JWKS is outside the issuer origin.");
  if (keys?.url !== jwksUri.href) {
    keys = {
      url: jwksUri.href,
      get: createRemoteJWKSet(jwksUri, { timeoutDuration: requestTimeout, cacheMaxAge: cacheTtl }),
    };
  }
  return jwtVerify(token, keys.get, { ...options, issuer, algorithms: ["ES256"] });
}
