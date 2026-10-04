// MCP 서버 프로토콜 테스트 — 에디터 없이 검증 가능한 범위(초기화·도구 목록·미연결 오류·브리지 HTTP)
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { TOOLS } from "../mcp/tools.mjs";

const SERVER = fileURLToPath(new URL("../mcp/server.mjs", import.meta.url));
const BRIDGE = fileURLToPath(new URL("../js/io/mcp-bridge.js", import.meta.url));
const PORT = 18000 + Math.floor(Math.random() * 1000);

function startServer() {
  const proc = spawn(process.execPath, [SERVER], { env: { ...process.env, CPE_MCP_PORT: String(PORT) }, stdio: ["pipe", "pipe", "pipe"] });
  let buf = "";
  let nextId = 1;
  const waiting = new Map();
  proc.stdout.on("data", (c) => {
    buf += c;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const m = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      waiting.get(m.id)?.(m);
      waiting.delete(m.id);
    }
  });
  const rpc = (method, params) => new Promise((res) => {
    const id = nextId++;
    waiting.set(id, res);
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  // 브리지 HTTP 가 열릴 때까지 대기(stderr 로그)
  const ready = new Promise((res) => proc.stderr.on("data", (c) => { if (String(c).includes("브리지 대기")) res(); }));
  return { proc, rpc, ready, stop: () => proc.stdin.end() };
}

test("모든 도구(bridge_status 제외)에 대응하는 브리지 핸들러 cmd_<이름> 이 있다", () => {
  const src = fs.readFileSync(BRIDGE, "utf8");
  for (const t of TOOLS) {
    if (t.name === "bridge_status") continue;
    assert.ok(src.includes(`cmd_${t.name}(`), `mcp-bridge.js 에 cmd_${t.name} 이 없습니다`);
  }
});

test("도구 정의 형식: 이름 중복 없음·inputSchema 는 object", () => {
  const names = TOOLS.map((t) => t.name);
  assert.equal(new Set(names).size, names.length);
  for (const t of TOOLS) {
    assert.equal(t.inputSchema.type, "object", t.name);
    assert.ok(t.description.length > 10, t.name);
  }
});

test("initialize → tools/list → 미연결 시 isError → HTTP 브리지 status/CORS/origin", async () => {
  const s = startServer();
  try {
    await s.ready;
    const init = await s.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    assert.equal(init.result.serverInfo.name, "canvas-photo-editor");
    assert.ok(init.result.capabilities.tools);

    const list = await s.rpc("tools/list", {});
    assert.equal(list.result.tools.length, TOOLS.length);

    // 에디터가 없으면 프로토콜 오류가 아니라 isError 결과
    const call = await s.rpc("tools/call", { name: "get_state", arguments: {} });
    assert.equal(call.result.isError, true);
    assert.match(call.result.content[0].text, /연결되어 있지 않습니다/);

    const unknown = await s.rpc("nope/method", {});
    assert.equal(unknown.error.code, -32601);

    const st = await fetch(`http://127.0.0.1:${PORT}/status`, { headers: { Origin: "http://localhost:8124" } });
    assert.equal(st.status, 200);
    assert.equal(st.headers.get("access-control-allow-origin"), "http://localhost:8124");
    assert.equal((await st.json()).connected, false);

    // 임의 웹사이트 origin 은 거부(브리지 가로채기 방지)
    const evil = await fetch(`http://127.0.0.1:${PORT}/status`, { headers: { Origin: "https://evil.example" } });
    assert.equal(evil.status, 403);
  } finally {
    s.stop();
  }
});

test("명령 왕복: 가짜 에디터가 poll → result 로 응답하면 도구 결과가 된다", async () => {
  const s = startServer();
  try {
    await s.ready;
    await s.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    // 가짜 에디터: 먼저 hello 폴링으로 연결 표시 후 명령을 기다린다
    const base = `http://127.0.0.1:${PORT}`;
    const fakeEditor = (async () => {
      const r = await fetch(`${base}/poll?hello=1&v=test`, { headers: { Origin: "http://localhost:8124" } });
      const cmd = await r.json();
      assert.equal(cmd.cmd, "get_state");
      await fetch(`${base}/result`, { method: "POST", body: JSON.stringify({ id: cmd.id, ok: true, result: { document: { width: 7 } } }) });
    })();
    // 연결 표시가 반영될 시간을 준 뒤 호출
    await new Promise((r) => setTimeout(r, 100));
    const call = await s.rpc("tools/call", { name: "get_state", arguments: {} });
    await fakeEditor;
    assert.equal(call.result.isError, undefined);
    assert.equal(JSON.parse(call.result.content[0].text).document.width, 7);
  } finally {
    s.stop();
  }
});
