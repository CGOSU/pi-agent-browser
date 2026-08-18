import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_PINCHTAB_SERVER,
  PinchtabClient,
  commandToPinchtabCall,
  pinchtabServerUrl,
} from "../extensions/pinchtab-client.js";

function response(body, status = 200) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return text;
    },
  };
}

test("validates and normalizes the PinchTab server URL", () => {
  assert.equal(pinchtabServerUrl(), DEFAULT_PINCHTAB_SERVER);
  assert.equal(pinchtabServerUrl("http://127.0.0.1:9867/"), DEFAULT_PINCHTAB_SERVER);
  assert.throws(() => pinchtabServerUrl("ftp://127.0.0.1:9867"), /http or https/);
  assert.throws(() => pinchtabServerUrl("not a url"), /Invalid PinchTab server URL/);
});

test("maps the browser command surface to PinchTab HTTP operations", () => {
  assert.deepEqual(commandToPinchtabCall("open https://example.test"), {
    action: "navigate",
    method: "POST",
    path: "/navigate",
    body: { url: "https://example.test" },
  });
  assert.deepEqual(commandToPinchtabCall("snapshot -i", { tabId: "tab-1" }), {
    action: "snapshot",
    method: "GET",
    path: "/snapshot",
    query: { interactive: "true", tabId: "tab-1" },
  });
  assert.deepEqual(commandToPinchtabCall('fill @e1 "hello world"', { tabId: "tab-1" }).body, {
    kind: "fill",
    selector: "e1",
    text: "hello world",
    tabId: "tab-1",
  });
  assert.deepEqual(commandToPinchtabCall("click .submit").body, {
    kind: "click",
    selector: ".submit",
  });
  assert.deepEqual(commandToPinchtabCall("type @e2 hello", { tabId: "tab-1" }).body, {
    kind: "type",
    selector: "e2",
    text: "hello",
    tabId: "tab-1",
  });
  assert.deepEqual(commandToPinchtabCall("select @e3 blue").body, {
    kind: "select",
    selector: "e3",
    value: "blue",
  });
  assert.deepEqual(commandToPinchtabCall("press Enter").body, { kind: "press", key: "Enter" });
  assert.deepEqual(commandToPinchtabCall("scroll down 400").body, { kind: "scroll", direction: "down", pixels: 400 });
  assert.equal(commandToPinchtabCall("get text @e4").path, "/text");
  assert.deepEqual(commandToPinchtabCall("get attr href @e4").query, { name: "href", ref: "e4" });
  assert.equal(commandToPinchtabCall("get url").path, "/url");
  assert.deepEqual(commandToPinchtabCall("wait @e5").body, { selector: "e5" });
  assert.deepEqual(commandToPinchtabCall("wait 250").body, { ms: 250 });
  assert.deepEqual(commandToPinchtabCall("screenshot --full").query, {
    format: "png",
    output: "inline",
    beyondViewport: "true",
  });
  assert.deepEqual(commandToPinchtabCall("eval document.title").body, { expression: "document.title" });
  assert.equal(commandToPinchtabCall("back", { tabId: "tab-1" }).path, "/tabs/tab-1/back");
  assert.equal(commandToPinchtabCall("forward").path, "/forward");
  assert.equal(commandToPinchtabCall("reload", { tabId: "tab-1" }).path, "/tabs/tab-1/reload");
  assert.deepEqual(commandToPinchtabCall("tab new https://new.test").body, {
    action: "new",
    url: "https://new.test",
  });
  assert.deepEqual(commandToPinchtabCall("tab switch tab-2").body, { action: "focus", tabId: "tab-2" });
  assert.deepEqual(commandToPinchtabCall("tab close", { tabId: "tab-1" }).body, { tabId: "tab-1" });
  assert.equal(commandToPinchtabCall("tab 2").index, 2);
  assert.deepEqual(commandToPinchtabCall("close", { tabId: "tab-1" }).body, { tabId: "tab-1" });
});

test("calls PinchTab HTTP endpoints, tracks tabs, and returns inline screenshots", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url);
    calls.push({ path: parsed.pathname, query: parsed.search, method: options.method, body: options.body, headers: options.headers });
    if (parsed.pathname === "/health") return response({ status: "ok" });
    if (parsed.pathname === "/navigate") return response({ tabId: "tab-1", url: "https://example.test", title: "Example" });
    if (parsed.pathname === "/action") return response({ ok: true });
    if (parsed.pathname === "/screenshot") return response({ format: "png", base64: "cG5n" });
    if (parsed.pathname === "/tabs") return response({ tabs: [{ id: "tab-1", url: "https://example.test" }] });
    if (parsed.pathname === "/tab") return response({ tabId: "tab-1", focused: true });
    if (parsed.pathname === "/close") return response({ closed: true, tabId: "tab-1" });
    if (parsed.pathname === "/text") return response("plain page text");
    return response({ ok: true });
  };
  const client = new PinchtabClient({
    server: "http://127.0.0.1:9867/",
    env: { PINCHTAB_SESSION: "ses-test" },
    fetchImpl,
  });

  await client.health();
  const open = await client.callCommand("open https://example.test");
  assert.equal(client.tabId, "tab-1");
  assert.match(open.result.content[0].text, /tab-1/);

  await client.callCommand("fill @e1 hello world");
  const screenshot = await client.callCommand("screenshot");
  assert.deepEqual(screenshot.result.content, [{ type: "image", data: "cG5n", mimeType: "image/png" }]);
  const text = await client.callCommand("get text");
  assert.deepEqual(text.result.content, [{ type: "text", text: "plain page text" }]);

  const focused = await client.callCommand("tab 1");
  assert.equal(client.tabId, "tab-1");
  assert.match(focused.result.content[0].text, /tab-1/);
  await client.callCommand("tab close");
  assert.equal(client.tabId, undefined);

  assert.equal(calls[0].path, "/health");
  assert.equal(calls[0].headers.authorization, "Session ses-test");
  const fillCall = calls.find((call) => call.path === "/action");
  assert.deepEqual(JSON.parse(fillCall.body), { kind: "fill", selector: "e1", text: "hello world", tabId: "tab-1" });
});

test("forwards bearer credentials and reports HTTP failures", async () => {
  const calls = [];
  const client = new PinchtabClient({
    env: { PINCHTAB_TOKEN: "server-token" },
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), headers: options.headers });
      return response({ error: "not allowed" }, 403);
    },
  });
  await assert.rejects(client.health(), /PinchTab GET \/health failed \(403\): not allowed/);
  assert.equal(calls[0].headers.authorization, "Bearer server-token");
});

test("close without an active tab does not send a destructive request", async () => {
  let calls = 0;
  const client = new PinchtabClient({ fetchImpl: async () => { calls += 1; return response({}); } });
  const result = await client.callCommand("close");
  assert.equal(calls, 0);
  assert.match(result.result.content[0].text, /No active/);
});
