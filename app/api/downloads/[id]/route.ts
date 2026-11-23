import { download } from "@/src/server/files";
import { viewerAccess, viewerUnauthorized } from "@/src/server/viewer-access";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await viewerAccess();
  if (!access.allowed) return viewerUnauthorized();
  const result = await download((await params).id, access.subject);
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
