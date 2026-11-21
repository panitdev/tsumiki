import { handleMcp } from "@/src/server/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export { handleMcp as GET, handleMcp as POST, handleMcp as DELETE };
