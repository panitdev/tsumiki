import { redirect } from "next/navigation";
import { browserAuthEnabled, readBrowserSession } from "./browser-auth";

export async function viewerAccess() {
  if (!browserAuthEnabled()) return { allowed: true as const, subject: undefined };
  const session = await readBrowserSession();
  if (session) return { allowed: true as const, subject: session.subject };
  return { allowed: false as const };
}

export async function requireViewerPage(returnTo: string) {
  if (!(await viewerAccess()).allowed) {
    redirect(`/auth/login?${new URLSearchParams({ returnTo })}`);
  }
}

export function viewerUnauthorized() {
  return Response.json({ error: "Sign in to access Tsumiki." }, {
    status: 401,
    headers: { "Cache-Control": "no-store" },
  });
}
