"use client";

import { Button } from "@charlotte-ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@charlotte-ui/dialog";
import { useState } from "react";

export function AgentConnection({ oauth = false }: { oauth?: boolean }) {
  const [endpoint, setEndpoint] = useState("");

  return (
    <Dialog onOpenChange={(open) => { if (open) setEndpoint(new URL("/api/mcp", window.location.origin).href); }}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">Connect an agent</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect an agent</DialogTitle>
          <DialogDescription>Add Tsumiki as a Streamable HTTP server in your MCP client.</DialogDescription>
        </DialogHeader>
        <dl className="agent-connection">
          <div>
            <dt>MCP URL</dt>
            <dd><code>{endpoint}</code></dd>
          </div>
          <div>
            <dt>Authorization</dt>
            <dd>{oauth ? "Sign in with Surge when your MCP client prompts you." : <code>Bearer &lt;your deployment token&gt; (when required)</code>}</dd>
          </div>
          <div>
            <dt>Find a structure</dt>
            <dd>Ask your agent to call <code>{"open({})"}</code> to list names and viewer links. It calls <code>{"open({name})"}</code> before working on a structure.</dd>
          </div>
          <div>
            <dt>Separate active selections</dt>
            <dd>Set a distinct <code>X-Tsumiki-Workspace</code> header per client if they should select structures independently.</dd>
          </div>
        </dl>
      </DialogContent>
    </Dialog>
  );
}
