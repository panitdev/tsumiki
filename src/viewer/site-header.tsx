import Link from "next/link";
import { Brandmark } from "./brandmark";
import { AgentConnection } from "./agent-connection";

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link href="/">
        <Brandmark />
      </Link>
      <AgentConnection />
    </header>
  );
}
