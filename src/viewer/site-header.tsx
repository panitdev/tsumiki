import Link from "next/link";
import { AgentConnection } from "./agent-connection";

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link href="/" className="wordmark">
        <picture>
          <source media="(prefers-color-scheme: dark)" srcSet="/tsumiki-logo-dark.svg" />
          <img src="/tsumiki-logo.svg" alt="" width={32} height={32} />
        </picture>
        <span>Tsumiki</span>
      </Link>
      <AgentConnection />
    </header>
  );
}
