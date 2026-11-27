"use client";

import { ChevronDown, ChevronRight, Eye, EyeOff, Focus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { TreeNode } from "./tree";

const LISTED_CHILDREN = 200;

export interface TreeState {
  hidden: ReadonlySet<string>;
  isolated: string | null;
  selected: string | null;
  onSelect: (key: string | null) => void;
  onHide: (key: string) => void;
  onIsolate: (key: string | null) => void;
}

function Row({ node, depth, state }: { node: TreeNode; depth: number; state: TreeState }) {
  const t = useTranslations("tree");
  const [open, setOpen] = useState(depth === 0);
  const { hidden, isolated, selected } = state;
  const isHidden = hidden.has(node.key);
  return (
    <li>
      <div className="tree-row" data-selected={selected === node.key} data-hidden={isHidden} style={{ paddingLeft: depth * 13 }}>
        {node.children.length ? (
          <button type="button" className="tree-button" aria-expanded={open} aria-label={`${open ? t("collapse") : t("expand")} ${node.label}`} onClick={() => setOpen(!open)}>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : <span className="tree-button" aria-hidden />}
        <button type="button" className="tree-label" aria-pressed={selected === node.key} title={node.detail ?? node.label}
          onClick={() => state.onSelect(selected === node.key ? null : node.key)}>
          <span>{node.label}</span>
          {node.detail && <small>{node.detail}</small>}
        </button>
        <button type="button" className="tree-button" aria-pressed={isolated === node.key} title={t("showOnlyThis")} aria-label={`${t("isolate")} ${node.label}`}
          onClick={() => state.onIsolate(isolated === node.key ? null : node.key)}>
          <Focus size={14} />
        </button>
        <button type="button" className="tree-button" aria-pressed={isHidden} title={isHidden ? t("show") : t("hide")} aria-label={`${isHidden ? t("show") : t("hide")} ${node.label}`}
          onClick={() => state.onHide(node.key)}>
          {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      {open && node.children.length > 0 && <Rows nodes={node.children} depth={depth + 1} state={state} />}
    </li>
  );
}

function Rows({ nodes, depth, state }: { nodes: TreeNode[]; depth: number; state: TreeState }) {
  const t = useTranslations("tree");
  return (
    <ul>
      {nodes.slice(0, LISTED_CHILDREN).map((node) => <Row key={node.key} node={node} depth={depth} state={state} />)}
      {nodes.length > LISTED_CHILDREN && <li className="control-help">{t("moreNotListed", { count: nodes.length - LISTED_CHILDREN })}</li>}
    </ul>
  );
}

export function GroupTree({ nodes, state }: { nodes: TreeNode[]; state: TreeState }) {
  const t = useTranslations("tree");
  if (!nodes.length) return <p className="control-help">{t("empty")}</p>;
  return <div className="group-tree"><Rows nodes={nodes} depth={0} state={state} /></div>;
}
