import { createHash, randomBytes } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import type { SignInFailure } from "./sign-in-failure";
import { fetchSurgeJson, loadSurgeMetadata, parsePublicUrl, surgeIssuerConfig, verifySurgeJwt } from "./surge-oauth";

const flowLifetime = 10 * 60;
const sessionLifetime = 8 * 60 * 60;
const flowType = "tsumiki-login+jwt";
const sessionType = "tsumiki-session+jwt";
const surgeSubject = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;

export function browserAuthEnabled() {
  return [
    process.env.TSUMIKI_OAUTH_ISSUER,
    process.env.TSUMIKI_OAUTH_RESOURCE,
    process.env.TSUMIKI_OAUTH_CLIENT_ID,
    process.env.TSUMIKI_OAUTH_CLIENT_SECRET,
    process.env.TSUMIKI_OAUTH_MCP_CLIENT_ID,
    process.env.TSUMIKI_OAUTH_INTROSPECTION_TOKEN,
    process.env.TSUMIKI_SESSION_SECRET,
  ].some((value) => value !== undefined);
}

function config() {
  const {
    TSUMIKI_OAUTH_CLIENT_ID: clientId,
    TSUMIKI_OAUTH_CLIENT_SECRET: clientSecret,
    TSUMIKI_BASE_URL: baseUrl,
    TSUMIKI_SESSION_SECRET: secret,
  } = process.env;
  const issuer = surgeIssuerConfig();
  if (!issuer || !clientId || !baseUrl || !secret || !/^[a-f0-9]{64}$/i.test(secret)) {
    throw new Error("Browser OAuth configuration is incomplete");
  }

  const { origin, protocol } = parsePublicUrl(baseUrl);
  const secure = protocol === "https:";
  const prefix = secure ? "__Host-" : "";
  return {
    issuer,
    clientId,
    clientSecret,
    origin,
    redirectUri: new URL("/auth/callback", origin).href,
    key: Buffer.from(secret, "hex"),
    flowCookie: `${prefix}tsumiki_oauth_flow`,
    sessionCookie: `${prefix}tsumiki_session`,
    cookieOptions: { path: "/", httpOnly: true, secure, sameSite: "lax" as const },
  };
}

type BrowserConfig = ReturnType<typeof config>;

function seal(settings: BrowserConfig, claims: Record<string, string>, type: string, lifetime: number) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256", typ: type })
    .setIssuer(settings.issuer)
    .setAudience(settings.redirectUri)
    .setExpirationTime(Math.floor(Date.now() / 1000) + lifetime)
    .sign(settings.key);
}

async function unseal(settings: BrowserConfig, token: string, type: string) {
  const { payload } = await jwtVerify(token, settings.key, {
    algorithms: ["HS256"],
    audience: settings.redirectUri,
    issuer: settings.issuer,
    typ: type,
    requiredClaims: ["exp", "clientId"],
  });
  if (payload.clientId !== settings.clientId) throw new Error("OAuth client changed");
  return payload;
}

export async function readBrowserSession(): Promise<{ subject: string } | null> {
  if (!browserAuthEnabled()) return null;
  try {
    const settings = config();
    const token = (await cookies()).get(settings.sessionCookie)?.value;
    if (!token) return null;
    const { sub } = await unseal(settings, token, sessionType);
    return typeof sub === "string" && surgeSubject.test(sub) ? { subject: sub.toLowerCase() } : null;
  } catch {
    return null;
  }
}

function safeReturnTo(value: string | null, origin: string) {
  if (!value || value.length > 1024 || !value.startsWith("/") || value.startsWith("//") ||
      /[\\\u0000-\u0020\u007f]/.test(value)) return "/";
  const candidate = new URL(value, origin);
  return candidate.origin === origin && !candidate.pathname.startsWith("//")
    ? `${candidate.pathname}${candidate.search}${candidate.hash}`
    : "/";
}

const privateHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

function redirect(location: URL) {
  return NextResponse.redirect(location, { status: 303, headers: privateHeaders });
}

function failure(message: string, status: number) {
  return new NextResponse(message, { status, headers: privateHeaders });
}

function signInFailure(reason: SignInFailure) {
  return new NextResponse(null, {
    status: 303,
    headers: { ...privateHeaders, Location: `/auth/error?reason=${reason}` },
  });
}

export async function beginBrowserLogin(request: NextRequest) {
  if (!browserAuthEnabled()) return signInFailure("disabled");
  try {
    const settings = config();
    const metadata = await loadSurgeMetadata(settings.issuer);
    const state = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    const returnTo = safeReturnTo(request.nextUrl.searchParams.get("returnTo"), settings.origin);
    const flow = await seal(settings, { state, nonce, verifier, returnTo, clientId: settings.clientId }, flowType, flowLifetime);
    const authorization = new URL(metadata.authorizationEndpoint);
    const parameters = {
      response_type: "code",
      client_id: settings.clientId,
      redirect_uri: settings.redirectUri,
      scope: "openid",
      state,
      nonce,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    };
    for (const [key, value] of Object.entries(parameters)) authorization.searchParams.set(key, value);

    const response = redirect(authorization);
    response.cookies.set(settings.flowCookie, flow, { ...settings.cookieOptions, maxAge: flowLifetime });
    return response;
  } catch {
    return signInFailure("unavailable");
  }
}

export async function completeBrowserLogin(request: NextRequest) {
  if (!browserAuthEnabled()) return signInFailure("disabled");
  let settings: BrowserConfig;
  try {
    settings = config();
  } catch {
    return signInFailure("unavailable");
  }

  const { searchParams } = request.nextUrl;
  const cookie = request.cookies.get(settings.flowCookie)?.value;
  function finish(response: NextResponse) {
    response.cookies.set(settings.flowCookie, "", { ...settings.cookieOptions, maxAge: 0 });
    return response;
  }

  let reason: SignInFailure = "invalid_flow";
  try {
    if (!cookie || searchParams.getAll("state").length !== 1) return finish(signInFailure(reason));
    const { state, nonce, verifier, returnTo } = await unseal(settings, cookie, flowType);
    if (typeof state !== "string" || state !== searchParams.get("state") ||
        typeof nonce !== "string" || typeof verifier !== "string" || typeof returnTo !== "string") {
      return finish(signInFailure(reason));
    }

    const errors = searchParams.getAll("error");
    const codes = searchParams.getAll("code");
    if (errors.length === 1 && codes.length === 0) {
      switch (errors[0]) {
        case "invalid_target": return finish(signInFailure("invalid_target"));
        case "access_denied": return finish(signInFailure("access_denied"));
        case "server_error":
        case "temporarily_unavailable": return finish(signInFailure("unavailable"));
        default: return finish(signInFailure("failed"));
      }
    }
    const [code] = codes;
    if (errors.length || codes.length !== 1 || !code) return finish(signInFailure(reason));

    reason = "failed";
    const metadata = await loadSurgeMetadata(settings.issuer);
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: settings.clientId,
      redirect_uri: settings.redirectUri,
      code_verifier: verifier,
    });
    if (settings.clientSecret) body.set("client_secret", settings.clientSecret);
    const tokens = await fetchSurgeJson(metadata.tokenEndpoint, { method: "POST", body });
    if (!tokens || typeof tokens !== "object" || !("id_token" in tokens) || typeof tokens.id_token !== "string") {
      throw new Error("OIDC ID token is missing");
    }
    const { payload } = await verifySurgeJwt(metadata.issuer, metadata.jwksUri, tokens.id_token, {
      algorithms: ["ES256"],
      audience: settings.clientId,
      issuer: metadata.issuer,
      typ: "JWT",
      requiredClaims: ["exp", "iat", "sub", "nonce"],
      maxTokenAge: flowLifetime,
      clockTolerance: 5,
    });
    if (payload.aud !== settings.clientId || payload.nonce !== nonce ||
        typeof payload.sub !== "string" || !surgeSubject.test(payload.sub)) {
      throw new Error("Invalid OIDC identity");
    }

    const session = await seal(settings, {
      sub: payload.sub.toLowerCase(),
      clientId: settings.clientId,
    }, sessionType, sessionLifetime);
    const response = redirect(new URL(safeReturnTo(returnTo, settings.origin), settings.origin));
    response.cookies.set(settings.sessionCookie, session, { ...settings.cookieOptions, maxAge: sessionLifetime });
    return finish(response);
  } catch {
    return finish(signInFailure(reason));
  }
}

export function endBrowserSession(request: NextRequest) {
  if (!browserAuthEnabled()) return failure("Sign-in is disabled.", 404);
  try {
    const settings = config();
    if (request.headers.get("origin") !== settings.origin) return failure("Invalid request origin.", 403);
    const response = redirect(new URL("/auth/signed-out", settings.origin));
    response.cookies.set(settings.sessionCookie, "", { ...settings.cookieOptions, maxAge: 0 });
    response.cookies.set(settings.flowCookie, "", { ...settings.cookieOptions, maxAge: 0 });
    return response;
  } catch {
    return failure("Sign-out is temporarily unavailable.", 503);
  }
}
