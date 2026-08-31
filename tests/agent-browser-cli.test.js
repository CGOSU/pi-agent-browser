import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  agentBrowserInstallHint,
  resolveAgentBrowser,
  resolveAgentBrowserPath,
  translateAgentBrowserCommand,
} from "../extensions/agent-browser-cli.js";

test("resolves an agent-browser executable from PATH", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-agent-browser-cli-"));
  const executable = join(dir, "agent-browser");
  writeFileSync(executable, "fixture");

  assert.deepEqual(resolveAgentBrowser({ platform: "linux", env: { PATH: dir } }), {
    command: executable,
    args: [],
  });
  assert.equal(resolveAgentBrowserPath({ platform: "linux", env: { PATH: dir } }), executable);
});

test("resolves the target executable behind the Windows npm shim", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-agent-browser-cli-win-"));
  const shim = join(dir, "agent-browser.cmd");
  const target = join(dir, "node_modules", "agent-browser", "bin", "agent-browser-win32-x64.exe");
  mkdirSync(join(dir, "node_modules", "agent-browser", "bin"), { recursive: true });
  writeFileSync(target, "fixture");
  writeFileSync(shim, `@echo off\n"%~dp0node_modules\\agent-browser\\bin\\agent-browser-win32-x64.exe" %*\n`);

  assert.deepEqual(resolveAgentBrowser({ platform: "win32", env: { PATH: dir } }), {
    command: target,
    args: [],
  });
});

test("maps the QR command to an inline screenshot", () => {
  assert.deepEqual(translateAgentBrowserCommand(["qr", "--full"]), ["screenshot", "--full"]);
  assert.deepEqual(translateAgentBrowserCommand(["open", "https://example.com"]), ["open", "https://example.com"]);
});

test("returns a manual installation hint without installing anything", () => {
  assert.match(agentBrowserInstallHint("win32"), /npm install -g agent-browser/);
  assert.match(agentBrowserInstallHint("linux"), /agent-browser install/);
});
