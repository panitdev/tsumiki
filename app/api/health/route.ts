import { checkDatabase } from "@/src/server/store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await checkDatabase();
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
