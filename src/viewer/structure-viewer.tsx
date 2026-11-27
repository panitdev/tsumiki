"use client";

import { Button } from "@charlotte-ui/button";
import { Card } from "@charlotte-ui/card";
import { ChevronLeft, Download, Layers3, ListTree, MousePointer2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { sceneBounds, groupPath, ROOT_LABEL, type SceneData } from "../engine/scene";
import { formatDimensions, numberFormat, structurePath } from "./data";
import { DownloadPanel } from "./download-panel";
import { GroupTree } from "./group-tree";
import { StructureCanvas } from "./structure-canvas";
import { blockGroup, buildTree, filterScene, findNode, nodeBounds } from "./tree";
import { useStructure } from "./use-structure";
import type { Inspected, ViewportScene } from "./viewport";

const emptyData: SceneData = { groups: [{ name: "", parent: -1 }], states: [], runs: [], instances: [] };

function pathOf(data: SceneData, group: number) {
  return groupPath({ groups: data.groups } as Parameters<typeof groupPath>[0], group) || ROOT_LABEL;
}

function Readout({ picked, data }: { picked: Inspected | null; data: SceneData }) {
  const t = useTranslations("viewer");
  if (picked?.kind === "display") {
    const instance = data.instances[picked.instance];
    if (instance) {
      return (
        <div className="inspector-readout">
          <code className="block-id">{instance.id}</code>
          <code className="block-properties">{[`@${instance.model}`, ...instance.tags.map((tag) => `.${tag}`)].join(" ")}</code>
          <p className="block-group">{pathOf(data, instance.group)}</p>
        </div>
      );
    }
  }
  if (picked?.kind !== "block") return <p className="control-help">{t("pickHint")}</p>;
  const bracket = picked.state.indexOf("[");
  return (
    <div className="inspector-readout">
      <code className="block-id">{bracket < 0 ? picked.state : picked.state.slice(0, bracket)}</code>
      {bracket >= 0 && <code className="block-properties">{picked.state.slice(bracket + 1, -1)}</code>}
      <p className="block-group">{pathOf(data, blockGroup(data, picked.x, picked.y, picked.z))}</p>
      <dl className="position-readout">
        {(["x", "y", "z"] as const).map((axis) => (
          <div key={axis}>
            <dt>{axis.toUpperCase()}</dt>
            <dd>{picked[axis]}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function StructureViewer({ name }: { name: string }) {
  const t = useTranslations("viewer");
  const endpoint = `/api/structures${structurePath(name)}`;
  const current = useStructure(endpoint);
  const [requestedCut, setRequestedCut] = useState<number | null>(null);
  const [inspected, setInspected] = useState<Inspected | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [isolated, setIsolated] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const { snapshot } = current;
  const data = snapshot?.build ?? emptyData;
  const frame = useMemo(() => sceneBounds(data), [data]);
  const tree = useMemo(() => buildTree(data), [data]);
  const cutY = frame && requestedCut !== null ? Math.max(frame[1], Math.min(frame[4], requestedCut)) : undefined;
  const deferredY = useDeferredValue(cutY);
  // Entries that a rebuild removed no longer isolate or select anything.
  const activeIsolation = isolated && findNode(tree, isolated) ? isolated : null;
  const selection = selected ? findNode(tree, selected) : undefined;
  const highlight = useMemo(() => selection ? nodeBounds(data, selection) : null, [data, selection]);
  const visible = useMemo(() => filterScene(data, tree, hidden, activeIsolation,
    frame && deferredY !== undefined ? [frame[0], frame[1], frame[2], frame[3], deferredY, frame[5]] : undefined),
    [data, tree, hidden, activeIsolation, frame, deferredY]);
  const scene = useMemo<ViewportScene | null>(
    () => snapshot ? { blocks: visible.blocks, displays: visible.displays, frame, highlight } : null,
    [snapshot, visible, frame, highlight]);

  const reportPick = useCallback((picked: Inspected | null) => {
    setInspected((previous) => JSON.stringify(previous) === JSON.stringify(picked) ? previous : picked);
  }, []);
  const toggleHidden = (key: string) => setHidden((previous) => {
    const next = new Set(previous);
    if (!next.delete(key)) next.add(key);
    return next;
  });
  const filtered = hidden.size > 0 || activeIsolation !== null;

  return (
    <main className="viewer-page">
      <Button asChild variant="link" className="back-link">
        <Link href="/"><ChevronLeft size={16} /> {t("back")}</Link>
      </Button>
      <div className="viewer-heading">
        <h1>{name}</h1>
        {snapshot && (
          <div className="viewer-meta">
            <span>{numberFormat.format(snapshot.blockCount)} {t("blockCount", { count: snapshot.blockCount })}</span>
            {snapshot.displayCount > 0 && <span>{numberFormat.format(snapshot.displayCount)} {t("displayCount", { count: snapshot.displayCount })}</span>}
            {frame && <span title={t("dimensionsTitle")}>{formatDimensions(frame)}</span>}
            <span className="connection" data-live={current.connection === "Live" && !current.error} role="status">
              <span aria-hidden />{current.error ? t("updateFailed") : t(current.connection.charAt(0).toLowerCase() + current.connection.slice(1))}
            </span>
          </div>
        )}
      </div>
      {current.error && snapshot && (
        <div className="update-error" role="alert">
          <p>{current.error}</p>
          <Button variant="outline" size="xs" onClick={current.retry}>{t("retry")}</Button>
        </div>
      )}
      {snapshot?.buildError && (
        <div className="update-error" role="status">
          <p>{t("lastGoodBuild", { error: snapshot.buildError })}</p>
        </div>
      )}
      <div className="viewer-layout">
        <div className="stage">
          <StructureCanvas snapshot={snapshot} scene={scene} requestError={current.error} onPick={reportPick} onRetry={current.retry} />
          <p className="camera-instructions" id="camera-instructions">
            <span className="drag-instructions">{t("dragInstructions")}</span>
            <span className="touch-instructions">{t("touchInstructions")}</span>
            <span className="sr-only">{t("keyboardInstructions")}</span>
          </p>
        </div>
        <Card className="viewer-controls" role="complementary" aria-label={t("controls")}>
          <section className="control-section" aria-labelledby="layer-label">
            <div className="control-heading">
              <Layers3 size={17} aria-hidden />
              <h2 id="layer-label">{t("ySlice")}</h2>
              <Button type="button" size="xs" variant="ghost" disabled={cutY === undefined} onClick={() => setRequestedCut(null)}>{t("showAll")}</Button>
            </div>
            <input
              aria-labelledby="layer-label"
              aria-valuetext={cutY === undefined ? t("allLayers") : t("upToY", { y: cutY })}
              type="range"
              min={frame?.[1] ?? 0}
              max={frame?.[4] ?? 0}
              value={cutY ?? frame?.[4] ?? 0}
              disabled={!frame || frame[1] === frame[4]}
              onChange={(event) => {
                const layer = event.currentTarget.valueAsNumber;
                setRequestedCut(layer === frame?.[4] ? null : layer);
              }}
            />
            <div className="range-labels">
              <span>{frame ? t("yLabel", { y: frame[1] }) : "—"}</span>
              <output>{cutY === undefined ? t("allLayers") : t("upToY", { y: cutY })}</output>
            </div>
          </section>

          <section className="control-section" aria-labelledby="groups-label">
            <div className="control-heading">
              <ListTree size={17} aria-hidden />
              <h2 id="groups-label">{t("groups")}</h2>
              <Button type="button" size="xs" variant="ghost" disabled={!filtered} onClick={() => { setHidden(new Set()); setIsolated(null); }}>{t("showAll")}</Button>
            </div>
            <GroupTree nodes={tree} state={{
              hidden, isolated: activeIsolation, selected,
              onSelect: setSelected, onHide: toggleHidden, onIsolate: setIsolated,
            }} />
          </section>

          <section className="control-section inspector" aria-labelledby="inspector-label">
            <div className="control-heading">
              <MousePointer2 size={16} aria-hidden />
              <h2 id="inspector-label">{t("blockInspector")}</h2>
            </div>
            <Readout picked={inspected} data={data} />
          </section>

          <section className="control-section download" aria-labelledby="download-label">
            <div className="control-heading">
              <Download size={16} aria-hidden />
              <h2 id="download-label">{t("export")}</h2>
            </div>
            <DownloadPanel endpoint={endpoint} name={name} disabled={!frame} />
          </section>
        </Card>
      </div>
    </main>
  );
}
