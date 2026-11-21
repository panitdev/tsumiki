import { changeEvents, getStructureInfo, ToolError, validateName } from "@/src/server/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ structure: string }> }) {
  const { structure } = await params;
  let initial: number;
  try {
    initial = (await getStructureInfo(validateName(structure))).version;
  } catch (error) {
    if (error instanceof ToolError) return new Response(error.message, { status: error.status });
    throw error;
  }
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let version = -1;
      let closed = false;
      const send = (next: number) => {
        if (closed || next <= version) return;
        version = next;
        controller.enqueue(encoder.encode(`event: change\ndata: ${JSON.stringify({ version })}\n\n`));
      };
      const timer = setInterval(() => {
        if ((controller.desiredSize ?? 0) > 0) controller.enqueue(encoder.encode(": keepalive\n\n"));
      }, 15_000);
      const onAbort = () => { cleanup(); controller.close(); };
      cleanup = () => {
        closed = true;
        clearInterval(timer);
        changeEvents.off(structure, send);
        request.signal.removeEventListener("abort", onAbort);
      };
      changeEvents.on(structure, send);
      request.signal.addEventListener("abort", onAbort, { once: true });
      if (request.signal.aborted) { onAbort(); return; }
      send(initial);
      // A commit could have happened between the first query and registering this listener.
      void getStructureInfo(structure).then((info) => send(info.version), () => {});
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
