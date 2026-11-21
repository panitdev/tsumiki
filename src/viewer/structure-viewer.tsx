"use client";

import { Button } from "@charlotte-ui/button";
import { Card } from "@charlotte-ui/card";
import { ChevronLeft, History, Layers3, LoaderCircle, MousePointer2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useDeferredValue, useEffect, useState } from "react";
import { formatDimensions, numberFormat, structurePath } from "./data";
import { StructureCanvas } from "./structure-canvas";
import { useHistory, useStructure } from "./use-structure";
import type { InspectedBlock } from "./viewport";

function Readout({ block }: { block: InspectedBlock | null }) {
  if (!block) return <p className="control-help">Hover or tap a block to see its ID and coordinates.</p>;
  const bracket = block.state.indexOf("[");
  return (
    <div className="inspector-readout">
      <code className="block-id">{bracket < 0 ? block.state : block.state.slice(0, bracket)}</code>
      {bracket >= 0 && <code className="block-properties">{block.state.slice(bracket + 1, -1)}</code>}
      <dl className="position-readout">
        {(["x", "y", "z"] as const).map((axis) => (
          <div key={axis}>
            <dt>{axis.toUpperCase()}</dt>
            <dd>{block[axis]}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function StructureViewer({ name }: { name: string }) {
  const endpoint = `/api/structures${structurePath(name)}`;
  const current = useStructure(endpoint);
  const [requestedStep, setRequestedStep] = useState<number | null>(null);
  const [requestedCut, setRequestedCut] = useState<number | null>(null);
  const [inspected, setInspected] = useState<InspectedBlock | null>(null);
  const history = useHistory(endpoint, current.snapshot, requestedStep);
  const liveDepth = current.snapshot?.historyDepth;
  const { snapshot } = history;
  const bounds = snapshot?.bounds;
  const cutY = bounds && requestedCut !== null ? Math.max(bounds[1], Math.min(bounds[4], requestedCut)) : undefined;
  const deferredY = useDeferredValue(cutY);
  const live = requestedStep === null;

  useEffect(() => {
    if (liveDepth === undefined) return;
    setRequestedStep((step) => step === null ? null : Math.min(step, liveDepth));
  }, [liveDepth]);

  const reportPick = useCallback((block: InspectedBlock | null) => {
    setInspected((previous) => {
      if (previous?.state === block?.state && previous?.x === block?.x && previous?.y === block?.y && previous?.z === block?.z) return previous;
      return block;
    });
  }, []);

  return (
    <main className="viewer-page">
      <Button asChild variant="link" className="back-link">
        <Link href="/"><ChevronLeft size={16} /> Structures</Link>
      </Button>
      <div className="viewer-heading">
        <h1>{name}</h1>
        {current.snapshot && (
          <div className="viewer-meta">
            <span>{numberFormat.format(snapshot?.blockCount ?? 0)} {snapshot?.blockCount === 1 ? "block" : "blocks"}</span>
            {bounds && <span title="Dimensions in X, Y, Z order">{formatDimensions(bounds)}</span>}
            <span className="connection" data-live={live && current.connection === "Live" && !current.error} role="status">
              <span aria-hidden />{live ? (current.error ? "Update failed" : current.connection) : "Viewing history"}
            </span>
          </div>
        )}
      </div>
      {current.error && current.snapshot && (
        <div className="update-error" role="alert">
          <p>{current.error}</p>
          <Button variant="outline" size="xs" onClick={current.retry}>Retry</Button>
        </div>
      )}
      <div className="viewer-layout">
        <div className="stage">
          <StructureCanvas snapshot={snapshot} cutY={deferredY} requestError={current.error} onPick={reportPick} onRetry={current.retry} />
          <p className="camera-instructions" id="camera-instructions">
            <span className="drag-instructions">Drag to orbit <span>·</span> Shift + drag to pan <span>·</span> Scroll to zoom</span>
            <span className="touch-instructions">Drag to orbit <span>·</span> Two fingers to pan or zoom</span>
            <span className="sr-only">With the canvas focused, use arrow keys to orbit, Shift and arrow keys to pan, plus and minus to zoom, and Home to frame the structure.</span>
          </p>
        </div>
        <Card className="viewer-controls" role="complementary" aria-label="Structure controls">
          <section className="control-section" aria-labelledby="layer-label">
            <div className="control-heading">
              <Layers3 size={17} aria-hidden />
              <h2 id="layer-label">Y slice</h2>
              <Button type="button" size="xs" variant="ghost" disabled={cutY === undefined} onClick={() => setRequestedCut(null)}>Show all</Button>
            </div>
            <input
              aria-labelledby="layer-label"
              aria-valuetext={cutY === undefined ? "All layers" : `Up to Y ${cutY}`}
              type="range"
              min={bounds?.[1] ?? 0}
              max={bounds?.[4] ?? 0}
              value={cutY ?? bounds?.[4] ?? 0}
              disabled={!bounds || bounds[1] === bounds[4]}
              onChange={(event) => {
                const layer = event.currentTarget.valueAsNumber;
                setRequestedCut(layer === bounds?.[4] ? null : layer);
              }}
            />
            <div className="range-labels">
              <span>{bounds ? `Y ${bounds[1]}` : "—"}</span>
              <output>{cutY === undefined ? "All layers" : `Up to Y ${cutY}`}</output>
            </div>
          </section>

          <section className="control-section" aria-labelledby="history-label" aria-busy={history.pending}>
            <div className="control-heading">
              <History size={17} aria-hidden />
              <h2 id="history-label">Build history</h2>
              <Button type="button" size="xs" variant="ghost" disabled={live} onClick={() => setRequestedStep(null)}>Go live</Button>
            </div>
            <input
              aria-labelledby="history-label"
              aria-valuetext={live ? "Latest" : `Step ${history.step} of ${history.depth}`}
              type="range"
              min={0}
              max={history.depth}
              value={history.step}
              disabled={!history.depth}
              onChange={(event) => {
                const step = event.currentTarget.valueAsNumber;
                setRequestedStep(step === history.depth ? null : step);
              }}
            />
            <div className="range-labels">
              <span>{history.depth ? "Initial" : "No build steps"}</span>
              <output>{history.pending && <LoaderCircle size={12} className="spin" aria-label="Loading step" />}{live ? "Latest" : `${history.step} / ${history.depth}`}</output>
            </div>
            {history.error && <p className="history-error" role="alert">{history.error}</p>}
          </section>

          <section className="control-section inspector" aria-labelledby="inspector-label">
            <div className="control-heading">
              <MousePointer2 size={16} aria-hidden />
              <h2 id="inspector-label">Block inspector</h2>
            </div>
            <Readout block={inspected} />
          </section>
        </Card>
      </div>
    </main>
  );
}
