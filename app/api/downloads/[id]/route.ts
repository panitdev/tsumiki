import { download } from "@/src/server/files";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const result = await download((await params).id);
  if (!result) return new Response("Download not found.", { status: 404 });
  const name = encodeURIComponent(result.name).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16)}`);
  return new Response(new Uint8Array(result.bytes), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${name}`,
      "Cache-Control": "private, no-store",
    },
  });
}
