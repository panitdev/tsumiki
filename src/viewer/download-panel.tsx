"use client";

import { Button } from "@charlotte-ui/button";
import { Download } from "lucide-react";
import { useState } from "react";

const formats = ["schem", "litematic", "nbt", "mcfunction"];

export function DownloadPanel({ endpoint, name, disabled }: { endpoint: string; name: string; disabled: boolean }) {
  const [format, setFormat] = useState(formats[0]);
  const [version, setVersion] = useState("26.3");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${endpoint}/export?${new URLSearchParams({ format, version })}`);
      if (!response.ok) throw new Error((await response.text()) || `Download failed (${response.status}).`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `${name.replace(/[<>:"|?*]/g, "_")}.${format}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn’t download the structure.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="download-fields">
        <label>Format
          <select value={format} onChange={(event) => setFormat(event.currentTarget.value)}>
            {formats.map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
        <label>Java version
          <input value={version} onChange={(event) => setVersion(event.currentTarget.value.trim())} />
        </label>
      </div>
      <Button type="button" size="sm" variant="outline" disabled={disabled || busy} onClick={download}>
        {busy ? "Preparing…" : "Download"} <Download size={14} aria-hidden />
      </Button>
      {error && <p className="control-error" role="alert">{error}</p>}
    </>
  );
}
