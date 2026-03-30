import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { and, eq, notInArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { companyMcpServers, agentMcpExclusions } from "@paperclipai/db";

interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  type?: "stdio" | "http" | "sse";
  url?: string;
}

export function mcpResolverService(db: Db) {
  return {
    async resolveMcpConfig(agentId: string, companyId: string) {
      // Get all exclusions for this agent
      const exclusions = await db
        .select({ mcpServerId: agentMcpExclusions.mcpServerId })
        .from(agentMcpExclusions)
        .where(eq(agentMcpExclusions.agentId, agentId));

      const excludedIds = exclusions.map((e) => e.mcpServerId);

      // Get company-wide servers + agent-specific servers, minus exclusions
      const conditions = [
        eq(companyMcpServers.companyId, companyId),
        eq(companyMcpServers.enabled, true),
      ];

      // Scope filter: company-wide or specifically for this agent
      const allServers = await db
        .select()
        .from(companyMcpServers)
        .where(and(...conditions));

      const servers = allServers.filter((s) => {
        // Exclude if in exclusion list
        if (excludedIds.includes(s.id)) return false;
        // Include if company-wide or specifically for this agent
        if (s.scope === "company") return true;
        if (s.scope === "agent" && s.agentId === agentId) return true;
        return false;
      });

      return servers;
    },

    async writeMcpConfigFile(
      servers: Array<{
        name: string;
        command: string;
        args: string[];
        env: Record<string, string>;
        transportType: string;
        transportUrl?: string | null;
      }>,
      tempDir: string,
    ) {
      const mcpConfig: Record<string, McpServerConfig> = {};

      for (const server of servers) {
        if (server.transportType === "http" || server.transportType === "sse") {
          // HTTP/SSE MCP servers use type + url format
          mcpConfig[server.name] = {
            type: server.transportType as "http" | "sse",
            url: server.transportUrl ?? "",
          };
        } else {
          // stdio MCP servers use command + args format
          mcpConfig[server.name] = {
            command: server.command,
            args: server.args,
            env: server.env,
          };
        }
      }

      const configPath = path.join(tempDir, "mcp-config.json");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify({ mcpServers: mcpConfig }, null, 2));

      return configPath;
    },

    async syncFromClaudeCode(companyId: string) {
      // Claude Code stores user-scoped MCPs in ~/.claude.json under "mcpServers"
      // and project-scoped MCPs in .mcp.json files.
      const sources = [
        path.join(os.homedir(), ".claude.json"),
        path.join(process.cwd(), ".mcp.json"),
      ];

      const discovered: Array<{
        name: string;
        command: string;
        args: string[];
        env: Record<string, string>;
        transportType: "stdio" | "http" | "sse";
        transportUrl?: string;
        configPath: string;
      }> = [];

      for (const configPath of sources) {
        if (!fs.existsSync(configPath)) continue;

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        } catch {
          continue;
        }

        const mcpServers = (parsed.mcpServers ?? {}) as Record<
          string,
          {
            command?: string;
            args?: string[];
            env?: Record<string, string>;
            type?: string;
            url?: string;
          }
        >;

        for (const [name, config] of Object.entries(mcpServers)) {
          const transportType = (config.type as "stdio" | "http" | "sse") ?? "stdio";
          discovered.push({
            name,
            command: config.command ?? "",
            args: config.args ?? [],
            env: config.env ?? {},
            transportType,
            transportUrl: config.url,
            configPath,
          });
        }
      }

      // Upsert into DB
      for (const server of discovered) {
        const [existing] = await db
          .select()
          .from(companyMcpServers)
          .where(
            and(
              eq(companyMcpServers.companyId, companyId),
              eq(companyMcpServers.name, server.name),
              eq(companyMcpServers.source, "claude_code_discovered"),
            ),
          )
          .limit(1);

        if (existing) {
          await db
            .update(companyMcpServers)
            .set({
              command: server.command,
              args: server.args,
              env: server.env,
              transportType: server.transportType,
              transportUrl: server.transportUrl ?? null,
              claudeCodeConfigPath: server.configPath,
              updatedAt: new Date(),
            })
            .where(eq(companyMcpServers.id, existing.id));
        } else {
          await db.insert(companyMcpServers).values({
            companyId,
            name: server.name,
            command: server.command,
            args: server.args,
            env: server.env,
            transportType: server.transportType,
            transportUrl: server.transportUrl ?? null,
            source: "claude_code_discovered",
            claudeCodeConfigPath: server.configPath,
            scope: "company",
            enabled: true,
          });
        }
      }

      return { discovered, message: `Discovered ${discovered.length} MCP servers from Claude Code` };
    },

    async listServers(companyId: string) {
      return db
        .select()
        .from(companyMcpServers)
        .where(eq(companyMcpServers.companyId, companyId));
    },

    async createServer(data: {
      companyId: string;
      name: string;
      description?: string | null;
      command: string;
      args?: string[];
      env?: Record<string, string>;
      transportType: "stdio" | "http" | "sse";
      transportUrl?: string | null;
      scope?: "company" | "agent";
      agentId?: string | null;
    }) {
      const [server] = await db
        .insert(companyMcpServers)
        .values({
          companyId: data.companyId,
          name: data.name,
          description: data.description ?? null,
          command: data.command,
          args: data.args ?? [],
          env: data.env ?? {},
          transportType: data.transportType,
          transportUrl: data.transportUrl ?? null,
          source: "manual",
          scope: data.scope ?? "company",
          agentId: data.agentId ?? null,
          enabled: true,
        })
        .returning();

      return server;
    },

    async updateServer(
      serverId: string,
      data: {
        name?: string;
        description?: string | null;
        command?: string;
        args?: string[];
        env?: Record<string, string>;
        transportType?: "stdio" | "http" | "sse";
        transportUrl?: string | null;
        enabled?: boolean;
      },
    ) {
      const [updated] = await db
        .update(companyMcpServers)
        .set({
          ...data,
          updatedAt: new Date(),
        })
        .where(eq(companyMcpServers.id, serverId))
        .returning();

      return updated;
    },

    async deleteServer(serverId: string) {
      const [deleted] = await db
        .delete(companyMcpServers)
        .where(eq(companyMcpServers.id, serverId))
        .returning();

      return deleted;
    },

    async addExclusion(agentId: string, mcpServerId: string) {
      await db
        .insert(agentMcpExclusions)
        .values({ agentId, mcpServerId })
        .onConflictDoNothing();

      return { success: true };
    },

    async removeExclusion(agentId: string, mcpServerId: string) {
      await db
        .delete(agentMcpExclusions)
        .where(
          and(
            eq(agentMcpExclusions.agentId, agentId),
            eq(agentMcpExclusions.mcpServerId, mcpServerId),
          ),
        );

      return { success: true };
    },

    async listExclusions(agentId: string) {
      return db
        .select()
        .from(agentMcpExclusions)
        .where(eq(agentMcpExclusions.agentId, agentId));
    },
  };
}
