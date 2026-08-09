import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { ObscuraMcpClient } from "../extensions/obscura-mcp-client.js";

const enabled = process.env.PI_OBSCURA_INTEGRATION === "1";

test("drives a local page through a real Obscura MCP process", { skip: !enabled }, async () => {
  const html = `<!doctype html>
<html>
  <head><title>pi-agent-browser integration</title></head>
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

  const client = new ObscuraMcpClient({
    env: {
      ...process.env,
      PI_OBSCURA_ALLOW_PRIVATE_NETWORK: "1",
    },
  });

  try {
    const { port } = server.address();
    const navigation = await client.callTool("browser_navigate", {
      url: `http://127.0.0.1:${port}/`,
    });
    assert.match(navigation.content?.[0]?.text || "", /Navigated/);

    const interactive = await client.callTool("browser_interactive_elements", {});
    const ref = interactive.content?.[0]?.text?.match(/ref=(e\d+)/)?.[1];
    assert.ok(ref, "Obscura should return an interactive input reference");

    await client.callTool("browser_fill", { ref, value: "你好" });
    const value = await client.callTool("browser_evaluate", {
      expression: "document.querySelector('#query').value",
    });
    assert.equal(value.content?.[0]?.text, "你好");

    const screenshot = await client.callTool("browser_screenshot", {});
    assert.equal(screenshot.content?.[0]?.type, "image");
    assert.equal(screenshot.content?.[0]?.mimeType, "image/png");
    assert.ok(screenshot.content?.[0]?.data);
  } finally {
    await client.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
