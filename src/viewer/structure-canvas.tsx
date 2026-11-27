"use client";

import { Button } from "@charlotte-ui/button";
import { Box, LoaderCircle, Maximize, Minus, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { makeResources, type RenderAssetData } from "../render/shared";
import { getJson, type StructureSnapshot } from "./data";
import { Viewport, type Inspected, type ViewportScene } from "./viewport";

let assetsRequest: Promise<ReturnType<typeof makeResources>> | null = null;

function loadAssets() {
  if (!assetsRequest) {
    const atlas = new Image();
    atlas.src = "/api/assets/atlas";
    assetsRequest = Promise.all([
      getJson<RenderAssetData>("/api/assets"),
      atlas.decode().catch(() => { throw new Error(ATLAS_ERROR); }),
    ]).then(([assets]) => makeResources(assets, atlas)).catch((error: unknown) => {
      assetsRequest = null;
      throw error;
    });
  }
  return assetsRequest;
}

function renderError(error: unknown) {
  return error instanceof Error ? error.message : RENDER_ERROR;
}

// Fallback messages thrown inside async loaders; the component translates
// errors with these well-known strings.
const ATLAS_ERROR = "Couldn’t load the Minecraft texture atlas.";
const RENDER_ERROR = "Couldn’t render the structure.";

interface StructureCanvasProps {
  snapshot: StructureSnapshot | null;
  scene: ViewportScene | null;
  requestError: string | null;
  onPick: (picked: Inspected | null) => void;
  onRetry: () => void;
}

export function StructureCanvas({ snapshot, scene, requestError, onPick, onRetry }: StructureCanvasProps) {
  const t = useTranslations("canvas");
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewport = useRef<Viewport | null>(null);
  const [assets, setAssets] = useState<ReturnType<typeof makeResources> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lost, setLost] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const hasBlocks = Boolean(snapshot?.blockCount || snapshot?.displayCount);

  useEffect(() => {
    if (!hasBlocks) return;
    let active = true;
    loadAssets().then(
      (result) => { if (active) setAssets(result); },
      (reason: unknown) => { if (active) setError(renderError(reason)); },
    );
    return () => { active = false; };
  }, [hasBlocks, attempt]);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const contextLost = (event: Event) => { event.preventDefault(); setLost(true); };
    const contextRestored = () => { setLost(false); setError(null); };
    element.addEventListener("webglcontextlost", contextLost);
    element.addEventListener("webglcontextrestored", contextRestored);
    return () => {
      element.removeEventListener("webglcontextlost", contextLost);
      element.removeEventListener("webglcontextrestored", contextRestored);
    };
  }, []);

  useEffect(() => {
    if (!canvas.current || !assets || lost) return;
    try {
      viewport.current = new Viewport(canvas.current, assets, onPick, (reason) => setError(renderError(reason)));
    } catch (reason) {
      setError(renderError(reason));
    }
    return () => {
      viewport.current?.dispose();
      viewport.current = null;
    };
  }, [assets, attempt, lost, onPick]);

  useEffect(() => {
    if (!scene) return;
    try {
      viewport.current?.setScene(scene);
    } catch (reason) {
      setError(renderError(reason));
    }
  }, [scene, assets, attempt, lost]);

  const sceneError = snapshot ? (hasBlocks ? error : null) : requestError;
  const busy = !sceneError && (!snapshot || (hasBlocks && !assets));
  const enabled = Boolean(snapshot && hasBlocks && assets && !sceneError && !lost);
  return (
    <div className="viewport" aria-busy={busy}>
      <canvas ref={canvas} aria-label={t("structure")} aria-describedby="camera-instructions" tabIndex={enabled ? 0 : -1} />
      {enabled && (
        <div className="camera-buttons" aria-label={t("cameraControls")} role="group">
          <Button type="button" variant="outline" size="icon-sm" title={t("zoomInTitle")} aria-label={t("zoomIn")} onClick={() => viewport.current?.zoom(0.8)}><Plus /></Button>
          <Button type="button" variant="outline" size="icon-sm" title={t("zoomOutTitle")} aria-label={t("zoomOut")} onClick={() => viewport.current?.zoom(1.25)}><Minus /></Button>
          <Button type="button" variant="outline" size="icon-sm" title={t("frameTitle")} aria-label={t("frame")} onClick={() => viewport.current?.frame()}><Maximize /></Button>
        </div>
      )}
      {(sceneError || busy || lost || !hasBlocks) && (
        <div className="viewport-message" role={sceneError ? "alert" : "status"}>
          {sceneError ? (
            <>
              <p>{sceneError}</p>
              <Button size="sm" variant="outline" onClick={snapshot ? () => { setError(null); setAttempt(attempt + 1); } : onRetry}>{t("tryAgain")}</Button>
            </>
          ) : busy || lost ? (
            <><LoaderCircle size={22} className="spin" /><p>{lost ? t("restoringGraphics") : snapshot ? t("loadingAssets") : t("loadingStructure")}</p></>
          ) : (
            <><span className="viewport-empty-icon"><Box size={27} strokeWidth={1.5} /></span><p>{t("empty")}</p></>
          )}
        </div>
      )}
    </div>
  );
}
