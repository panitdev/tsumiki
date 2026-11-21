import { listStructures } from "@/src/server/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ structures: await listStructures() }, { headers: { "Cache-Control": "no-store" } });
}
