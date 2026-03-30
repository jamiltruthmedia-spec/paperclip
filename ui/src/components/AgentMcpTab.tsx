import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { mcpServersApi, type McpServer } from "../api/mcpServers";
import { queryKeys } from "../lib/queryKeys";
import { useToast } from "../context/ToastContext";
import { cn } from "../lib/utils";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Server, ExternalLink, ShieldOff, ShieldCheck, Settings } from "lucide-react";
import { useState } from "react";

const transportColors: Record<string, string> = {
  stdio: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  http: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  sse: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
};

interface AgentMcpTabProps {
  agentId: string;
  companyId: string;
  companyPrefix: string;
}

export function AgentMcpTab({ agentId, companyId, companyPrefix }: AgentMcpTabProps) {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [confirmExclusion, setConfirmExclusion] = useState<{
    serverId: string;
    action: "add" | "remove";
    name: string;
  } | null>(null);

  const serversQuery = useQuery({
    queryKey: queryKeys.mcpServers.list(companyId),
    queryFn: () => mcpServersApi.list(companyId),
  });

  const addExclusionMutation = useMutation({
    mutationFn: (serverId: string) => mcpServersApi.addExclusion(agentId, serverId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers.list(companyId) });
      pushToast({ title: "MCP excluded for this agent" });
      setConfirmExclusion(null);
    },
    onError: () => pushToast({ tone: "warn", title: "Failed to add exclusion" }),
  });

  const removeExclusionMutation = useMutation({
    mutationFn: (serverId: string) => mcpServersApi.removeExclusion(agentId, serverId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers.list(companyId) });
      pushToast({ title: "Exclusion removed" });
      setConfirmExclusion(null);
    },
    onError: () => pushToast({ tone: "warn", title: "Failed to remove exclusion" }),
  });

  const servers = serversQuery.data ?? [];
  const companyServers = servers.filter((s) => s.scope === "company" && s.enabled);
  const agentServers = servers.filter((s) => s.scope === "agent" && s.agentId === agentId);
  const allRelevant = [...companyServers, ...agentServers];

  if (serversQuery.isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="p-4">
            <div className="h-5 w-40 bg-muted animate-pulse rounded" />
            <div className="h-3 w-64 bg-muted animate-pulse rounded mt-2" />
          </Card>
        ))}
      </div>
    );
  }

  if (allRelevant.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Server className="h-10 w-10 text-muted-foreground/30 mb-3" />
        <p className="text-sm text-muted-foreground mb-4">
          No MCPs configured. Set up MCPs in company settings.
        </p>
        <Link to={`/${companyPrefix}/mcp-servers`}>
          <Button variant="outline" size="sm">
            <Settings className="h-3.5 w-3.5 mr-1.5" />
            Company MCP Settings
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {allRelevant.length} MCP server{allRelevant.length !== 1 ? "s" : ""} available to this
          agent
        </p>
        <Link to={`/${companyPrefix}/mcp-servers`}>
          <Button variant="outline" size="sm">
            <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
            Manage MCPs
          </Button>
        </Link>
      </div>

      <div className="space-y-2">
        {allRelevant.map((server) => (
          <McpServerCard
            key={server.id}
            server={server}
            onExclude={() =>
              setConfirmExclusion({ serverId: server.id, action: "add", name: server.name })
            }
            onRemoveExclusion={() =>
              setConfirmExclusion({ serverId: server.id, action: "remove", name: server.name })
            }
          />
        ))}
      </div>

      {/* Exclusion Confirmation */}
      <Dialog
        open={!!confirmExclusion}
        onOpenChange={(open) => !open && setConfirmExclusion(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {confirmExclusion?.action === "add" ? "Exclude MCP" : "Remove Exclusion"}
            </DialogTitle>
            <DialogDescription>
              {confirmExclusion?.action === "add"
                ? `Exclude "${confirmExclusion.name}" from this agent? The agent will no longer have access to this MCP server.`
                : `Remove the exclusion for "${confirmExclusion?.name}"? The agent will regain access to this MCP server.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmExclusion(null)}>
              Cancel
            </Button>
            <Button
              variant={confirmExclusion?.action === "add" ? "destructive" : "default"}
              onClick={() => {
                if (!confirmExclusion) return;
                if (confirmExclusion.action === "add") {
                  addExclusionMutation.mutate(confirmExclusion.serverId);
                } else {
                  removeExclusionMutation.mutate(confirmExclusion.serverId);
                }
              }}
              disabled={addExclusionMutation.isPending || removeExclusionMutation.isPending}
            >
              {addExclusionMutation.isPending || removeExclusionMutation.isPending
                ? "Saving..."
                : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function McpServerCard({
  server,
  onExclude,
  onRemoveExclusion,
}: {
  server: McpServer;
  onExclude: () => void;
  onRemoveExclusion: () => void;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Server className="h-4 w-4 text-muted-foreground shrink-0" />
            <h4 className="text-sm font-medium truncate">{server.name}</h4>
            <Badge
              variant="secondary"
              className={cn("text-[10px] px-1.5 py-0", transportColors[server.transportType])}
            >
              {server.transportType}
            </Badge>
            <Badge
              variant="secondary"
              className="text-[10px] px-1.5 py-0"
            >
              {server.scope}
            </Badge>
            {!server.enabled && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
                disabled
              </Badge>
            )}
          </div>
          {server.description && (
            <p className="text-xs text-muted-foreground line-clamp-1 ml-6">
              {server.description}
            </p>
          )}
          <p className="text-xs text-muted-foreground/60 ml-6 mt-0.5 font-mono">
            {server.command} {server.args.join(" ")}
          </p>
        </div>
        <div className="shrink-0">
          {server.scope === "company" && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onExclude}>
              <ShieldOff className="h-3.5 w-3.5 mr-1" />
              Exclude
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
