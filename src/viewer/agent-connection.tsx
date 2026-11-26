"use client";

import { Button } from "@charlotte-ui/button";
import { ActionRow, ActionRowGroup } from "@charlotte-ui/labs/action-row";
import { FlowDialog, FlowDialogBack, FlowDialogHeading } from "@charlotte-ui/labs/flow-dialog";
import { Bot, Code, Copy, Check, MessageCircle, Plug, Terminal } from "lucide-react";
import { useState } from "react";

function CopyRow({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="code-row">
      <code>{value}</code>
      <button
        type="button"
        aria-label="Copy to clipboard"
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

const clients: { id: ClientId; label: string; description: string; icon: React.ReactNode; iconClassName: string }[] = [
  { id: "claude-web", label: "Claude", description: "claude.ai", icon: <MessageCircle size={20} />, iconClassName: "text-muted-foreground" },
  { id: "chatgpt", label: "ChatGPT", description: "chatgpt.com", icon: <Bot size={20} />, iconClassName: "text-muted-foreground" },
  { id: "claude-code", label: "Claude Code", description: "Anthropic's terminal agent", icon: <Terminal size={20} />, iconClassName: "text-muted-foreground" },
  { id: "codex", label: "Codex", description: "OpenAI's coding agent", icon: <Code size={20} />, iconClassName: "text-muted-foreground" },
  { id: "manual", label: "Manual (MCP)", description: "Any MCP client, paste the URL", icon: <Plug size={20} />, iconClassName: "text-muted-foreground" },
];

export function AgentConnection({ oauth = false, publicEndpoint }: { oauth?: boolean; publicEndpoint?: string }) {
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

  const auth = oauth ? "Sign in with Surge when your client asks you to." : "No sign-in needed.";
  const client = clients.find((c) => c.id === view);

  const detail = (id: ClientId, endpoint: string, publicHost: boolean) => {
    const url = (
      <div>
        <dt>MCP URL</dt>
        <dd><CopyRow value={endpoint} /></dd>
      </div>
    );
    switch (id) {
      case "claude-web":
        return (
          <>
            {publicHost
              ? <p>In Claude, go to <strong>Customize &rsaquo; Connectors</strong>, choose <strong>+ Add &rsaquo; Add custom connector</strong>, and paste the URL below.</p>
              : <p>Run this site on a public HTTPS address, then add it as a custom connector in Claude&apos;s settings.</p>}
            {url}
            <div>
              <dt>Authorization</dt>
              <dd>{oauth ? "Sign in with Surge when Claude asks you to." : "No sign-in needed."}</dd>
            </div>
          </>
        );
      case "chatgpt":
        return (
          <>
            <p>
              ChatGPT&apos;s connectors can read remote servers but only run search and fetch —
              they cannot call Tsumiki&apos;s build tool, so it&apos;s not usable as a connector yet.
            </p>
            {url}
          </>
        );
      case "claude-code":
        return (
          <>
            <p>From your project folder, run:</p>
            <CopyRow value={`claude mcp add --transport http tsumiki ${endpoint}`} />
            <p>Sign in with Surge when Claude Code opens the browser.</p>
            {url}
            <div>
              <dt>Authorization</dt>
              <dd>{oauth ? "Sign in with Surge when Claude Code opens the browser." : "No sign-in needed."}</dd>
            </div>
          </>
        );
      case "codex":
        return (
          <>
            <p>From your project folder, run:</p>
            <CopyRow value={`codex mcp add tsumiki --url ${endpoint}`} />
            {oauth && <p>If Codex can&apos;t sign in on its own, register an OAuth client with Surge and add <code>--oauth-client-id &lt;id&gt;</code> to the command.</p>}
            {url}
            <div>
              <dt>Authorization</dt>
              <dd>{oauth ? "Sign in with Surge when Codex opens the browser." : "No sign-in needed."}</dd>
            </div>
          </>
        );
      case "manual":
        return (
          <>
            <p>Paste the URL below into your client&apos;s server settings as a remote (Streamable HTTP) MCP server.</p>
            {url}
            <div>
              <dt>Authorization</dt>
              <dd>{auth}</dd>
            </div>
            <div>
              <dt>Keeping clients apart</dt>
              <dd>Each connected client keeps its own current structure, so two agents can work side by side without getting in each other&apos;s way.</dd>
            </div>
          </>
        );
    }
  };

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(true)}>Connect an agent</Button>
      <FlowDialog open={open} onOpenChange={onOpenChange} view={view} title="Connect an agent">
      <div className="agent-connection-view">
        {view === "menu" ? (
          <>
            <FlowDialogHeading title="Connect an agent" description="Pick your client to add Tsumiki." />
            <ActionRowGroup>
              {clients.map((c) => (
                <ActionRow key={c.id} icon={c.icon} iconClassName={c.iconClassName} label={c.label} description={c.description} chevron onSelect={() => setView(c.id)} />
              ))}
            </ActionRowGroup>
            <p className="agent-connection-fineprint">
              Claude, ChatGPT and Codex are trademarks of their respective owners.
              Tsumiki is not affiliated with or endorsed by them.
            </p>
          </>
        ) : (
          <>
            <FlowDialogHeading
              title={client?.label ?? ""}
              description={client?.id === "chatgpt" ? "Not supported yet." : "Add Tsumiki as a remote MCP server."}
            />
            {detail(view, endpoint, publicHost)}
            <FlowDialogBack onClick={() => setView("menu")}>Back</FlowDialogBack>
          </>
        )}
      </div>
      </FlowDialog>
    </>
  );
}
