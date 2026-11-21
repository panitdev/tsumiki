"use client";

import { Button } from "@charlotte-ui/button";
import { Card } from "@charlotte-ui/card";
import { ArrowUpRight, Box, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatDimensions, getJson, numberFormat, structurePath, type StructureSummary } from "./data";

export function StructureList() {
  const [structures, setStructures] = useState<StructureSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [request, setRequest] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getJson<{ structures: StructureSummary[] }>("/api/structures", controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) setStructures(result.structures);
      },
      (reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Couldn’t load structures.");
      },
    );
    return () => controller.abort();
  }, [request]);

  if (error) {
    return (
      <Card className="list-state" role="alert">
        <p>{error}</p>
        <Button variant="outline" size="sm" onClick={() => { setError(null); setRequest(request + 1); }}>Try again</Button>
      </Card>
    );
  }

  if (!structures) {
    return <Card className="list-state" role="status"><LoaderCircle className="spin" size={20} /> Loading structures</Card>;
  }

  if (structures.length === 0) {
    return (
      <Card className="list-state list-empty">
        <span className="list-icon"><Box size={22} strokeWidth={1.6} /></span>
        <strong>No structures yet</strong>
        <p>Connect an agent, then ask it to open a named structure.</p>
      </Card>
    );
  }

  return (
    <Card className="structure-directory">
      <ul className="structure-list" aria-label="Structures">
        {structures.map((structure) => (
          <li key={structure.name}>
            <Link className="structure-link" href={structurePath(structure.name)}>
              <span className="list-icon"><Box size={21} strokeWidth={1.6} /></span>
              <span className="structure-list-details">
                <strong>{structure.name}</strong>
                <span>{numberFormat.format(structure.blockCount)} {structure.blockCount === 1 ? "block" : "blocks"}</span>
              </span>
              {structure.bounds && <span className="list-dimensions">{formatDimensions(structure.bounds)}</span>}
              <ArrowUpRight size={18} aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
