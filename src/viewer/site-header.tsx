import Link from "next/link";
import { Button } from "@charlotte-ui/button";
import { browserAuthEnabled } from "../server/browser-auth";
import { Brandmark } from "./brandmark";
import { AgentConnection } from "./agent-connection";

export function SiteHeader() {
  const oauth = browserAuthEnabled();
  return (
    <header className="site-header">
      <Link href="/">
        <Brandmark />
      </Link>
      <div className="flex items-center gap-2">
        <AgentConnection oauth={oauth} />
        {oauth && (
          <form action="/auth/logout" method="post">
            <Button type="submit" variant="outline" size="sm">Sign out</Button>
          </form>
        )}
      </div>
    </header>
  );
}
