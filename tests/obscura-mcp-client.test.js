import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  ObscuraMcpClient,
  commandToMcpCall,
  mcpResultToPiContent,
  obscuraExecutable,
  obscuraLaunchArgs,
} from "../extensions/obscura-mcp-client.js";

function fixturePath() {
  return join(tmpdir(), `pi-obscura-mcp-fixture-${process.pid}-${Date.now()}.mjs`);
}

function writeFixture(path) {
  writeFileSync(path, `
let input = "";
let sequence = 0;
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  let newline;
  while ((newline = input.indexOf("\\n")) !== -1) {
    const line = input.slice(0, newline).trim();
    input = input.slice(newline + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.id === undefined) continue;

    let result;
    if (message.method === "initialize") {
      result = {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "fixture", version: "1" },
      };
    } else if (message.method === "tools/call") {
      const name = message.params.name;
      const args = message.params.arguments;
      if (name === "browser_screenshot") {
        result = { content: [{ type: "image", data: "cG5n", mimeType: "image/png" }] };
      } else {
        result = { content: [{ type: "text", text: JSON.stringify({ sequence: sequence++, name, args }) }] };
      }
    } else {
      result = {};
    }

    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\\n");
  }
});
`);
}

async function withFixture(callback) {
  const path = fixturePath();
  writeFixture(path);
  const client = new ObscuraMcpClient({ executable: process.execPath, args: [path] });
  try {
    return await callback(client);
  } finally {
    await client.close();
    rmSync(path, { force: true });
  }
}

test("maps browser commands to Obscura MCP tools", () => {
  assert.deepEqual(commandToMcpCall('fill @e1 "hello world"'), {
    action: "fill",
    tool: "browser_fill",
    arguments: { ref: "e1", value: "hello world" },
  });
  assert.deepEqual(commandToMcpCall("click .submit"), {
    action: "click",
    tool: "browser_click",
    arguments: { selector: ".submit" },
  });
  assert.deepEqual(commandToMcpCall("select @e2 blue"), {
    action: "select",
    tool: "browser_select_option",
    arguments: { selector: '[data-obscura-ref="e2"]', value: "blue" },
  });
  assert.equal(commandToMcpCall("snapshot -i").tool, "browser_interactive_elements");
  assert.equal(commandToMcpCall("wait 250").localWaitMs, 250);
  assert.match(commandToMcpCall("get text @e3").arguments.expression, /data-obscura-ref/);
  assert.throws(() => commandToMcpCall("screenshot --full"), /viewport screenshots only/);
});

test("builds the configured Obscura command", () => {
  assert.equal(obscuraExecutable({}, "win32"), "obscura.exe");
  assert.equal(obscuraExecutable({ PI_OBSCURA_PATH: "C:/bin/obscura.exe" }, "win32"), "C:/bin/obscura.exe");
  assert.deepEqual(
    obscuraLaunchArgs({
      PI_OBSCURA_STEALTH: "1",
      PI_OBSCURA_PROXY: "http://127.0.0.1:8080",
      PI_OBSCURA_USER_AGENT: "Test UA",
      PI_OBSCURA_ALLOW_PRIVATE_NETWORK: "true",
    }),
    ["mcp", "--stealth", "--proxy", "http://127.0.0.1:8080", "--user-agent", "Test UA", "--allow-private-network"],
  );
});

test("performs the MCP handshake and calls tools", async () => {
  await withFixture(async (client) => {
    const result = await client.callTool("browser_fill", { ref: "e1", value: "你好" });
    const call = JSON.parse(result.content[0].text);
    assert.equal(call.name, "browser_fill");
    assert.deepEqual(call.args, { ref: "e1", value: "你好" });
  });
});

test("serializes concurrent browser calls", async () => {
  await withFixture(async (client) => {
    const results = await Promise.all([
      client.callTool("first", { value: 1 }),
      client.callTool("second", { value: 2 }),
    ]);
    const calls = results.map((result) => JSON.parse(result.content[0].text));
    assert.deepEqual(calls.map((call) => call.sequence), [0, 1]);
    assert.deepEqual(calls.map((call) => call.name), ["first", "second"]);
  });
});

test("converts MCP images to Pi content", () => {
  assert.deepEqual(
    mcpResultToPiContent({ content: [{ type: "image", data: "cG5n", mimeType: "image/png" }] }),
    [{ type: "image", data: "cG5n", mimeType: "image/png" }],
  );
});
