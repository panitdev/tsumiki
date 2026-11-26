import { useEffect, useState } from "react";
import { getJson, type StructureSnapshot } from "./data";

interface StructureResponse {
  snapshot: StructureSnapshot | null;
  error: string | null;
}

export function useStructure(endpoint: string) {
  const [latest, setLatest] = useState<StructureResponse>({ snapshot: null, error: null });
  const [connection, setConnection] = useState<"Connecting" | "Live" | "Reconnecting">("Connecting");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    let request: AbortController | undefined;
    let source: EventSource | undefined;
    let version: number | undefined;

    function refresh() {
      request?.abort();
      const controller = new AbortController();
      request = controller;
      getJson<StructureSnapshot>(endpoint, controller.signal).then(
        (snapshot) => {
          if (controller.signal.aborted) return;
          version = snapshot.version;
          setLatest({ snapshot, error: null });
          if (!source && active) watch();
        },
        (reason: unknown) => {
          if (controller.signal.aborted) return;
          setLatest((current) => ({
            ...current,
            error: reason instanceof Error ? reason.message : "Couldn’t load this structure.",
          }));
        },
      );
    }

    function watch() {
      source = new EventSource(`${endpoint}/events`);
      source.onopen = () => { if (active) setConnection("Live"); };
      source.onerror = () => { if (active) setConnection("Reconnecting"); };
      source.addEventListener("change", (event: MessageEvent<string>) => {
        if (!active) return;
        const change = JSON.parse(event.data) as { version: number };
        if (change.version !== version) refresh();
      });
    }

    refresh();
    return () => {
      active = false;
      request?.abort();
      source?.close();
    };
  }, [endpoint, attempt]);

  return {
    ...latest,
    connection,
    retry: () => {
      setConnection("Connecting");
      setLatest((current) => ({ ...current, error: null }));
      setAttempt(attempt + 1);
    },
  };
}
