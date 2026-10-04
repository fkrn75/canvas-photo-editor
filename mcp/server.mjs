#!/usr/bin/env node
// Canvas Photo Editor MCP 서버 — 외부 의존성 0 (Node 18+ 내장 모듈만 사용)
//
// 구조:
//   AI 클라이언트(Claude 등) ──stdio JSON-RPC(MCP)──▶ 이 서버 ──HTTP 롱폴링(127.0.0.1)──▶ 에디터 페이지
//   - 에디터 페이지(js/io/mcp-bridge.js)가 GET /poll 로 명령을 기다렸다가 실행하고 POST /result 로 돌려준다.
//   - 페이지가 클라이언트(폴링 쪽)이므로 크롬 확장 페이지·8124 정적서버 어디서 열어도 동작한다.
//   - 브리지는 에디터에서 [도움말 > AI 연결(MCP)]을 켰을 때만 동작한다(기본 꺼짐 = 네트워크 호출 0 유지).
//
// 실행: node mcp/server.mjs   (환경변수 CPE_MCP_PORT 로 포트 변경, 기본 8131)
// stdout 은 MCP 프로토콜 전용이다 — 로그는 반드시 stderr 로만 쓴다.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { TOOLS } from "./tools.mjs";

const PORT = parseInt(process.env.CPE_MCP_PORT || "8131", 10);
const HOST = "127.0.0.1";
const POLL_HOLD_MS = 20000;         // 롱폴링 1회 대기 시간
const CLIENT_ALIVE_MS = 30000;      // 마지막 폴링 후 이 시간 안이면 "연결됨"으로 간주
const DEFAULT_CALL_TIMEOUT_MS = 60000;
const MAX_BODY = 256 * 1024 * 1024; // 결과 본문 상한(대형 PNG 대비)
const VERSION = "0.8.0";

const log = (...a) => process.stderr.write(`[cpe-mcp] ${a.join(" ")}\n`);

// ───────────────────────── 에디터 브리지 (HTTP 롱폴링) ─────────────────────────

const queue = [];            // 아직 페이지에 전달되지 않은 명령
const waiters = [];          // 명령을 기다리는 폴링 응답 { res, origin, timer }
const pending = new Map();   // id → { resolve, reject, timer } (페이지 결과 대기)
let lastSeen = 0;            // 마지막 폴링 시각
let clientInfo = null;       // 페이지가 알려준 정보(origin·버전)
let httpReady = false;
let httpError = null;

// 확장 페이지(chrome-extension://)·로컬 정적서버만 허용 — 임의 웹페이지가 브리지를 가로채지 못하게 한다.
function originAllowed(origin) {
  if (!origin) return true; // 비브라우저(curl 등 로컬 프로세스)
  return /^chrome-extension:\/\/[a-p]{32}$/.test(origin)
    || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    // 크롬 Private Network Access 사전요청 대응(확장 페이지 → 127.0.0.1)
    "Access-Control-Allow-Private-Network": "true",
    "Vary": "Origin",
  };
}

function send(res, status, body, origin, type = "application/json") {
  const headers = { ...corsHeaders(origin), "Cache-Control": "no-store" };
  if (body === undefined) { res.writeHead(status, headers); res.end(); return; }
  headers["Content-Type"] = type;
  res.writeHead(status, headers);
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error("본문이 너무 큽니다")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// 대기 중인 폴러에 큐의 명령을 넘긴다.
function flush() {
  while (queue.length && waiters.length) {
    const w = waiters.shift();
    clearTimeout(w.timer);
    if (w.res.writableEnded || w.res.destroyed) continue;
    send(w.res, 200, queue.shift(), w.origin);
  }
}

function isConnected() {
  return waiters.length > 0 || Date.now() - lastSeen < CLIENT_ALIVE_MS;
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (!originAllowed(origin)) { send(res, 403, { error: "origin not allowed" }); return; }
  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  if (req.method === "OPTIONS") { send(res, 204, undefined, origin); return; }

  if (req.method === "GET" && url.pathname === "/status") {
    send(res, 200, { name: "canvas-photo-editor-mcp", version: VERSION, connected: isConnected(), client: clientInfo }, origin);
    return;
  }

  if (req.method === "GET" && url.pathname === "/poll") {
    lastSeen = Date.now();
    if (url.searchParams.get("hello")) {
      clientInfo = { origin: origin || null, version: url.searchParams.get("v") || null, at: new Date().toISOString() };
      log(`에디터 연결: ${clientInfo.origin || "(origin 없음)"} v${clientInfo.version}`);
    }
    if (queue.length) { send(res, 200, queue.shift(), origin); return; }
    const w = { res, origin, timer: null };
    w.timer = setTimeout(() => {
      const i = waiters.indexOf(w);
      if (i >= 0) waiters.splice(i, 1);
      lastSeen = Date.now();
      if (!res.writableEnded) send(res, 204, undefined, origin);
    }, POLL_HOLD_MS);
    res.on("close", () => {
      const i = waiters.indexOf(w);
      if (i >= 0) { waiters.splice(i, 1); clearTimeout(w.timer); }
    });
    waiters.push(w);
    return;
  }

  if (req.method === "POST" && url.pathname === "/result") {
    lastSeen = Date.now();
    let msg;
    try { msg = JSON.parse(await readBody(req)); }
    catch (e) { send(res, 400, { error: String(e.message || e) }, origin); return; }
    const p = pending.get(msg.id);
    if (p) {
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.result); else p.reject(new Error(msg.error || "에디터에서 실패"));
    }
    send(res, 200, { ok: true }, origin);
    return;
  }

  send(res, 404, { error: "not found" }, origin);
});

server.on("error", (e) => {
  httpError = e;
  log(`HTTP 브리지 시작 실패(${HOST}:${PORT}): ${e.code || e.message}`);
});
server.listen(PORT, HOST, () => { httpReady = true; log(`브리지 대기 http://${HOST}:${PORT}`); });

// 에디터에 명령을 보내고 결과를 기다린다.
function callEditor(cmd, args, timeoutMs = DEFAULT_CALL_TIMEOUT_MS) {
  if (!httpReady) {
    const why = httpError?.code === "EADDRINUSE"
      ? `포트 ${PORT}을(를) 다른 프로세스가 사용 중입니다(다른 MCP 세션이 이미 브리지를 열었을 수 있음). CPE_MCP_PORT 로 포트를 바꾸고 에디터의 연결 포트도 맞추세요.`
      : `HTTP 브리지가 열리지 않았습니다: ${httpError?.message || "시작 중"}`;
    return Promise.reject(new Error(why));
  }
  if (!isConnected()) {
    return Promise.reject(new Error(
      `에디터가 연결되어 있지 않습니다. Canvas Photo Editor를 열고 [도움말 > AI 연결(MCP)]을 켜세요 (포트 ${PORT}).`));
  }
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      const qi = queue.findIndex((q) => q.id === id);
      if (qi >= 0) queue.splice(qi, 1);
      reject(new Error(`에디터 응답 시간 초과(${Math.round(timeoutMs / 1000)}초) — 탭이 멈췄거나 작업이 너무 무겁습니다.`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    queue.push({ id, cmd, args: args || {} });
    flush();
  });
}

// ───────────────────────── 서버 측 전·후처리 ─────────────────────────

const MIME_BY_EXT = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".bmp": "image/bmp" };

// open_image: 로컬 경로는 서버가 읽어서 data URL 로 넘긴다(페이지는 파일시스템 접근 불가).
function prepareArgs(name, args) {
  if (name === "open_image" && args.path) {
    const p = path.resolve(args.path);
    const mime = MIME_BY_EXT[path.extname(p).toLowerCase()];
    if (!mime) throw new Error(`지원하지 않는 이미지 확장자입니다: ${p}`);
    const buf = fs.readFileSync(p);
    const { path: _drop, ...rest } = args;
    return { ...rest, data_url: `data:${mime};base64,${buf.toString("base64")}`, name: rest.name || path.basename(p, path.extname(p)) };
  }
  return args;
}

// 페이지 결과 → MCP content 배열. result.image(=저장용 원본)·result.preview(=AI가 볼 미리보기)를 처리.
function toContent(args, result) {
  const r = { ...(result || {}) };
  if (r.image && args.path) {
    const out = path.resolve(args.path);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(r.image.data, "base64"));
    r.saved_to = out;
    r.bytes = fs.statSync(out).size;
  }
  delete r.image;
  const preview = r.preview;
  delete r.preview;
  const content = [{ type: "text", text: JSON.stringify(r, null, 2) }];
  if (preview && args.return_image !== false) content.push({ type: "image", data: preview.data, mimeType: preview.mimeType });
  return content;
}

async function callTool(name, args) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`알 수 없는 도구: ${name}`);
  if (name === "bridge_status") {
    return [{ type: "text", text: JSON.stringify({ port: PORT, http_ready: httpReady, http_error: httpError?.code || null, connected: isConnected(), client: clientInfo, queued: queue.length }, null, 2) }];
  }
  const prepared = prepareArgs(name, args);
  const result = await callEditor(name, prepared, tool.timeoutMs);
  return toContent(args, result);
}

// ───────────────────────── MCP (stdio JSON-RPC 2.0) ─────────────────────────

const write = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
const reply = (id, result) => write({ jsonrpc: "2.0", id, result });
const replyError = (id, code, message) => write({ jsonrpc: "2.0", id, error: { code, message } });

const INSTRUCTIONS = [
  "Canvas Photo Editor(브라우저에서 동작하는 포토샵7 클론)를 제어한다.",
  "먼저 get_state 로 연결과 문서 상태를 확인하라. 연결이 안 되면 사용자에게 에디터의 [도움말 > AI 연결(MCP)]을 켜 달라고 안내하라.",
  "좌표는 문서 픽셀 좌표(왼쪽 위 0,0). 그리기·필터는 활성 레이어(선택 영역이 있으면 그 안)에 적용되며 undo 가능하다.",
  "결과 확인은 get_image(미리보기)로, 파일 저장은 export_image(path)로 한다.",
].join("\n");

async function handle(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;
  try {
    switch (method) {
      case "initialize":
        reply(id, {
          protocolVersion: params?.protocolVersion || "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "canvas-photo-editor", version: VERSION },
          instructions: INSTRUCTIONS,
        });
        return;
      case "ping":
        if (isRequest) reply(id, {});
        return;
      case "tools/list":
        reply(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
        return;
      case "tools/call":
        try {
          reply(id, { content: await callTool(params?.name, params?.arguments || {}) });
        } catch (e) {
          // 도구 실행 실패는 프로토콜 에러가 아니라 isError 결과로 돌려준다(모델이 읽고 대처하도록).
          reply(id, { content: [{ type: "text", text: `오류: ${e.message || e}` }], isError: true });
        }
        return;
      default:
        if (method?.startsWith("notifications/")) return;
        if (isRequest) replyError(id, -32601, `Method not found: ${method}`);
    }
  } catch (e) {
    if (isRequest) replyError(id, -32603, String(e.message || e));
  }
}

let inbuf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  inbuf += chunk;
  let nl;
  while ((nl = inbuf.indexOf("\n")) >= 0) {
    const line = inbuf.slice(0, nl).trim();
    inbuf = inbuf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { replyError(null, -32700, "Parse error"); continue; }
    handle(msg);
  }
});
// 클라이언트가 stdin 을 닫으면(세션 종료) 브리지도 정리하고 종료한다.
process.stdin.on("end", () => { server.close(); process.exit(0); });
