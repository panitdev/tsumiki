"use client";

import { Button } from "@charlotte-ui/button";
import { ActionRow, ActionRowGroup } from "@charlotte-ui/labs/action-row";
import { FlowDialog, FlowDialogBack, FlowDialogHeading } from "@charlotte-ui/labs/flow-dialog";
import { Bot, Code, Copy, Check, MessageCircle, Plug, Terminal } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

function CopyRow({ value }: { value: string }) {
  const t = useTranslations("agent");
  const [copied, setCopied] = useState(false);
  return (
    <div className="code-row">
      <code>{value}</code>
      <button
        type="button"
        aria-label={t("agent.copy")}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            // Clipboard can be blocked (e.g. insecure origin); the text stays selectable.
          }
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}

type ClientId = "claude-web" | "chatgpt" | "claude-code" | "codex" | "manual";

const CLIENT_ICONS: { id: ClientId; icon: React.ReactNode; iconClassName: string }[] = [
  { id: "claude-web", icon: <MessageCircle size={20} />, iconClassName: "text-muted-foreground" },
  { id: "chatgpt", icon: <Bot size={20} />, iconClassName: "text-muted-foreground" },
  { id: "claude-code", icon: <Terminal size={20} />, iconClassName: "text-muted-foreground" },
  { id: "codex", icon: <Code size={20} />, iconClassName: "text-muted-foreground" },
  { id: "manual", icon: <Plug size={20} />, iconClassName: "text-muted-foreground" },
];

const CLIENT_TEXT: Record<ClientId, { label: string; description: string }> = {
  "claude-web": { label: "claudeWeb", description: "claudeWebDesc" },
  chatgpt: { label: "chatgpt", description: "chatgptDesc" },
  "claude-code": { label: "claudeCode", description: "claudeCodeDesc" },
  codex: { label: "codex", description: "codexDesc" },
  manual: { label: "manual", description: "manualDesc" },
};

export function AgentConnection({ oauth = false, publicEndpoint }: { oauth?: boolean; publicEndpoint?: string }) {
  const t = useTranslations("agent");
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"menu" | ClientId>("menu");
  const [localEndpoint, setLocalEndpoint] = useState("");

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setLocalEndpoint(new URL("/api/mcp", window.location.origin).href);
      setView("menu");
    }
  };

  const endpoint = publicEndpoint ?? localEndpoint;
  const publicHost = endpoint.startsWith("https://");

  const auth = oauth ? t("signInGeneric") : t("noSignIn");
  const client = CLIENT_TEXT[view as ClientId] ?? null;

  const detail = (id: ClientId, endpoint: string, publicHost: boolean) => {
    const url = (
      <div>
        <dt>{t("mcpUrl")}</dt>
        <dd><CopyRow value={endpoint} /></dd>
      </div>
    );
    switch (id) {
      case "claude-web":
        return (
          <>
            {publicHost
              ? <p>{t.rich("claudeWebPublic", { strong: (chunks) => <strong>{chunks}</strong> })}</p>
              : <p>{t("claudeWebLocal")}</p>}
            {url}
            <div>
              <dt>{t("authorization")}</dt>
              <dd>{oauth ? t("signInClaude") : t("noSignIn")}</dd>
            </div>
          </>
        );
      case "chatgpt":
        return (
          <>
            <p>{t("chatgptLimitation")}</p>
            {url}
          </>
        );
      case "claude-code":
        return (
          <>
            <p>{t("runFromProject")}</p>
            <CopyRow value={`claude mcp add --transport http tsumiki ${endpoint}`} />
            <p>{t("signInClaudeCode")}</p>
            {url}
            <div>
              <dt>{t("authorization")}</dt>
              <dd>{oauth ? t("signInClaudeCode") : t("noSignIn")}</dd>
            </div>
          </>
        );
      case "codex":
        return (
          <>
            <p>{t("runFromProject")}</p>
            <CopyRow value={`codex mcp add tsumiki --url ${endpoint}`} />
            {oauth && <p>{t.rich("codexOauthHint", { clientId: "<id>", code: (chunks) => <code>{chunks}</code> })}</p>}
            {url}
            <div>
              <dt>{t("authorization")}</dt>
              <dd>{oauth ? t("signInCodex") : t("noSignIn")}</dd>
            </div>
          </>
        );
      case "manual":
        return (
          <>
            <p>{t("manualIntro")}</p>
            {url}
            <div>
              <dt>{t("authorization")}</dt>
              <dd>{auth}</dd>
            </div>
            <div>
              <dt>{t("multiClientTitle")}</dt>
              <dd>{t("multiClientBody")}</dd>
            </div>
          </>
        );
    }
  };

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(true)}>{t("connect")}</Button>
      <FlowDialog open={open} onOpenChange={onOpenChange} view={view} title={t("connect")}>
      <div className="agent-connection-view">
        {view === "menu" ? (
          <>
            <FlowDialogHeading title={t("connect")} description={t("headingDescription")} />
            <ActionRowGroup>
              {CLIENT_ICONS.map((c) => (
                <ActionRow key={c.id} icon={c.icon} iconClassName={c.iconClassName} label={t(CLIENT_TEXT[c.id].label)} description={t(CLIENT_TEXT[c.id].description)} chevron onSelect={() => setView(c.id)} />
              ))}
            </ActionRowGroup>
            <p className="agent-connection-fineprint">
              {t("fineprint")}
            </p>
          </>
        ) : (
          <>
            <FlowDialogHeading
              title={client ? t(CLIENT_TEXT[view as ClientId].label) : ""}
              description={view === "chatgpt" ? t("notSupported") : t("remoteDescription")}
            />
            {detail(view, endpoint, publicHost)}
            <FlowDialogBack onClick={() => setView("menu")}>{t("back")}</FlowDialogBack>
          </>
        )}
      </div>
      </FlowDialog>
    </>
  );
}
