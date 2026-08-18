import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { DEFAULT_PINCHTAB_SERVER, PinchtabClient } from "../extensions/pinchtab-client.js";

const enabled = process.env.PI_PINCHTAB_INTEGRATION === "1";

test("drives a local page through a real PinchTab HTTP server", { skip: !enabled }, async () => {
  const html = `<!doctype html>
<html>
  <head><title>pi-agent-browser PinchTab integration</title></head>
  <body>
    <input id="query">
    <button id="submit">Submit</button>
  </body>
</html>`;
  const server = http.createServer((_request, response) => {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      connection: "close",
    });
    response.end(html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  const client = new PinchtabClient({
    server: process.env.PI_PINCHTAB_URL || DEFAULT_PINCHTAB_SERVER,
    env: process.env,
  });

  try {
    await client.health({ timeout: 5000 });
    const { port } = server.address();
    const navigation = await client.callCommand(`open http://127.0.0.1:${port}/`, { timeout: 30_000 });
    assert.match(navigation.result.content?.[0]?.text || "", /tabId|url/);

    const text = await client.callCommand("get text", { timeout: 10_000 });
    assert.match(text.result.content?.[0]?.text || "", /Submit/);

    await client.callCommand('fill #query "你好"', { timeout: 10_000 });
    const value = await client.callCommand("get value #query", { timeout: 10_000 });
    assert.match(value.result.content?.[0]?.text || "", /你好/);

    const screenshot = await client.callCommand("screenshot", { timeout: 10_000 });
    assert.equal(screenshot.result.content?.[0]?.type, "image");
    assert.ok(screenshot.result.content?.[0]?.data);
  } finally {
    if (client.tabId) {
      await client.callCommand("close", { timeout: 10_000 }).catch(() => undefined);
    }
    await client.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
