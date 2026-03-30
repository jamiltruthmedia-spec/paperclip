import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { agents } from "@paperclipai/db";
import { eq } from "drizzle-orm";
import { postRunEvalService } from "../services/agent-runtime/post-run-eval.js";
import { kpiAnalyticsService } from "../services/agent-runtime/kpi-analytics.js";
import { assertCompanyAccess } from "./authz.js";

export function agentKpiRoutes(db: Db) {
  const router = Router();
  const postRun = postRunEvalService(db);
  const analytics = kpiAnalyticsService(db);

  async function getAgentCompanyId(agentId: string): Promise<string | null> {
    const [agent] = await db
      .select({ companyId: agents.companyId })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);
    return agent?.companyId ?? null;
  }

  // List KPIs for an agent
  router.get("/agents/:agentId/kpis", async (req, res) => {
    const { agentId } = req.params;
    const companyId = await getAgentCompanyId(agentId);
    if (!companyId) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    assertCompanyAccess(req, companyId);

    const from = req.query.from ? new Date(req.query.from as string) : undefined;
    const to = req.query.to ? new Date(req.query.to as string) : undefined;
    const projectId = req.query.projectId as string | undefined;

    const kpis = await postRun.getAgentKpis(agentId, { from, to, projectId });
    res.json(kpis);
  });

  // Get trend data for an agent
  router.get("/agents/:agentId/kpis/trends", async (req, res) => {
    const { agentId } = req.params;
    const companyId = await getAgentCompanyId(agentId);
    if (!companyId) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    assertCompanyAccess(req, companyId);

    const windowSize = req.query.windowSize ? parseInt(req.query.windowSize as string, 10) : 10;
    const trends = await postRun.getAgentTrends(agentId, windowSize);
    res.json(trends);
  });

  // Company-wide analytics
  router.get("/companies/:companyId/analytics", async (req, res) => {
    const { companyId } = req.params;
    assertCompanyAccess(req, companyId);

    const result = await analytics.getCompanyAnalytics(companyId);
    res.json(result);
  });

  // List observations
  router.get("/companies/:companyId/analytics/observations", async (req, res) => {
    const { companyId } = req.params;
    assertCompanyAccess(req, companyId);

    const observations = await analytics.listObservations(companyId);
    res.json(observations);
  });

  // Create observation
  router.post("/companies/:companyId/analytics/observations", async (req, res) => {
    const { companyId } = req.params;
    assertCompanyAccess(req, companyId);

    const { observerType, observerAgentId, observerUserId, observation, agentIds, actionTaken, actionNotes } =
      req.body;

    if (!observerType || !observation) {
      res.status(400).json({ error: "Missing required fields: observerType, observation" });
      return;
    }

    const result = await analytics.createObservation({
      companyId,
      observerType,
      observerAgentId,
      observerUserId,
      observation,
      agentIds,
      actionTaken,
      actionNotes,
    });

    res.status(201).json(result);
  });

  // Delete observation
  router.delete("/companies/:companyId/analytics/observations/:id", async (req, res) => {
    const { companyId, id } = req.params;
    assertCompanyAccess(req, companyId);

    const deleted = await analytics.deleteObservation(id);
    if (!deleted) {
      res.status(404).json({ error: "Observation not found" });
      return;
    }

    res.json({ success: true });
  });

  return router;
}
