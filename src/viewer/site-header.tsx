import Link from "next/link";
import { Button } from "@charlotte-ui/button";
import { getTranslations } from "next-intl/server";
import { browserAuthEnabled } from "../server/browser-auth";
import { mcpOAuthConfig } from "../server/mcp-oauth";
import { Brandmark } from "./brandmark";
import { AgentConnection } from "./agent-connection";
import { LocaleSwitcher } from "./locale-switcher";

export async function SiteHeader() {
  const t = await getTranslations("header");
  const oauth = browserAuthEnabled();
  let mcpOauth = false;
  let publicEndpoint: string | undefined;
  try {
    const config = mcpOAuthConfig();
    mcpOauth = config !== undefined;
    publicEndpoint = config?.resource.href;
  } catch {
    mcpOauth = true;
  }
  return (
    <header className="site-header">
      <Link href="/">
        <Brandmark />
      </Link>
      <div className="flex items-center gap-2">
        <LocaleSwitcher />
        <AgentConnection oauth={mcpOauth} publicEndpoint={publicEndpoint} />
        {oauth && (
          <form action="/auth/logout" method="post">
            <Button type="submit" variant="outline" size="sm">{t("signOut")}</Button>
          </form>
        )}
      </div>
    </header>
  );
}
