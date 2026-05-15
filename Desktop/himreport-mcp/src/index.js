import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";

const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbwDZq_LGYROGSGmhHJ-hbGhqNsFXlZZcNymVTdnvbsopjgcHb8sxJDd8SGIgURTZsP3/exec";
const TOKEN = "thehim2026";

async function callAppsScript(payload) {
  console.log("[callAppsScript] action:", payload.action, "email:", payload.email || "");
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      redirect: "follow",
    });
    console.log("[callAppsScript] HTTP status:", res.status, "url:", res.url);
    const text = await res.text();
    console.log("[callAppsScript] response:", text.substring(0, 300));
    return JSON.parse(text);
  } catch (err) {
    console.error("[callAppsScript] ERROR:", err.message);
    throw err;
  }
}

function buildServer() {
  const server = new McpServer({ name: "himreport-mcp", version: "1.0.0" });

  server.tool(
    "get_context",
    "힘클로드 공통 기반지식 조회 — 직원정보·프로젝트 목록·최근 28일 보고·오늘 일정",
    { email: z.string().describe("직원 이메일") },
    async ({ email }) => {
      const data = await callAppsScript({ token: TOKEN, action: "get_context", email });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "send_daily_report",
    "일일보고 최종 발송 (Google Drive 저장 + Gmail 발송)",
    {
      name:    z.string().describe("보고자 이름"),
      role:    z.string().describe("직책"),
      dept:    z.string().describe("부서"),
      grade:   z.string().describe("등급 (L1~L4)"),
      date:    z.string().describe("날짜 yyyy-MM-dd"),
      to:      z.string().describe("수신 이메일"),
      cc:      z.string().optional().describe("참조 이메일"),
      subject: z.string().describe("이메일 제목"),
      raw:     z.string().describe("원문"),
      structured: z.object({
        pj:       z.string(),
        meeting:  z.string(),
        issue:    z.string(),
        dir:      z.string(),
        schedule: z.string(),
      }).describe("보고 5개 필드 — pj·meeting·issue·dir·schedule"),
    },
    async (params) => {
      const data = await callAppsScript({ token: TOKEN, action: "send_daily_report", ...params });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  return server;
}

// 세션별 transport 보관
const sessions = new Map();

const app = express();
app.use(express.json());
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id");
  next();
});
app.options("*", (_req, res) => res.sendStatus(204));

async function getOrCreateTransport(req) {
  const sid = req.headers["mcp-session-id"];
  if (sid && sessions.has(sid)) return sessions.get(sid);

  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => sessions.set(id, transport),
  });
  await server.connect(transport);
  return transport;
}

app.post("/mcp", async (req, res) => {
  try {
    const t = await getOrCreateTransport(req);
    await t.handleRequest(req, res, req.body);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

app.get("/mcp", async (req, res) => {
  const t = sessions.get(req.headers["mcp-session-id"]);
  if (!t) return res.status(400).json({ error: "unknown session" });
  try {
    await t.handleRequest(req, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

app.delete("/mcp", async (req, res) => {
  const sid = req.headers["mcp-session-id"];
  if (sessions.has(sid)) {
    await sessions.get(sid).close();
    sessions.delete(sid);
  }
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`himreport-mcp on :${PORT}`));
