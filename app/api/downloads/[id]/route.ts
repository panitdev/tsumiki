import { attachment } from "@/src/server/attachment";
import { download } from "@/src/server/files";
import { viewerAccess, viewerUnauthorized } from "@/src/server/viewer-access";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await viewerAccess();
  if (!access.allowed) return viewerUnauthorized();
  const result = await download((await params).id, access.subject);
  if (!result) return new Response("Download not found.", { status: 404 });
  return attachment(result.name, result.bytes);
}
