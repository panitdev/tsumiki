import { Box } from "lucide-react";
import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link href="/" className="wordmark">
        <span className="wordmark-icon"><Box size={18} strokeWidth={1.8} /></span>
        <span>Tsumiki</span>
      </Link>
    </header>
  );
}
