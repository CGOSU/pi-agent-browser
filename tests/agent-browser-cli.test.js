import assert from "node:assert/strict";
import { register } from "node:module";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  agentBrowserInstallHint,
  resolveAgentBrowser,
  resolveAgentBrowserPath,
  translateAgentBrowserCommand,
} from "../extensions/agent-browser-cli.js";
import { getPersistencePaths } from "../extensions/persistence.js";

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

const extensionMocks = {
  "@mariozechner/pi-coding-agent":
    'export const DEFAULT_MAX_BYTES = 1000; export const DEFAULT_MAX_LINES = 100; export const formatSize = () => "size"; export const truncateHead = (content) => ({ content, truncated: false, outputLines: 1, totalLines: 1, outputBytes: content.length, totalBytes: content.length });',
  "@mariozechner/pi-tui": 'export function getCapabilities() { return globalThis.__piBrowserTestCapabilities ?? { images: null }; } export class Text { constructor(...args) { this.args = args; } }',
  "@sinclair/typebox": 'export const Type = { Object: () => ({}), String: () => ({}) };',
};
let browserExtensionPromise;

async function loadBrowserExtension() {
  if (!process.features?.typescript) return undefined;
  if (!browserExtensionPromise) {
    const loader = `const mockedSources = ${JSON.stringify(extensionMocks)}; export function resolve(specifier, context, nextResolve) { const source = mockedSources[specifier]; if (source) return { url: \"data:text/javascript,\" + encodeURIComponent(source), shortCircuit: true }; return nextResolve(specifier, context); }`;
    register(`data:text/javascript,${encodeURIComponent(loader)}`, { parentURL: import.meta.url });
    browserExtensionPromise = import(new URL(`../extensions/index.ts?test=${Date.now()}`, import.meta.url).href)
      .then((module) => module.default);
  }
  return browserExtensionPromise;
}

function createFakePi() {
  const calls = [];
  const events = new Map();
  const pi = {
    calls,
    events,
    tool: undefined,
    execResult: { code: 0, stdout: "ok", stderr: "" },
    registerTool(tool) {
      this.tool = tool;
    },
    on(event, handler) {
      events.set(event, handler);
    },
    exec(command, args, options) {
      calls.push({ command, args, options });
      return Promise.resolve(this.execResult);
    },
  };
  return pi;
}

async function runBrowserTool(pi, command) {
  return pi.tool.execute("test-call", { command }, undefined, undefined, undefined);
}

async function withBrowserEnvironment(root, callback, extra = {}) {
  const keys = [
    "PATH",
    "LOCALAPPDATA",
    "HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "AGENT_BROWSER_PROFILE",
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const executableName = process.platform === "win32" ? "agent-browser.exe" : "agent-browser";
  writeFileSync(join(root, executableName), "fixture");

  process.env.PATH = root;
  if (process.platform === "win32") {
    process.env.LOCALAPPDATA = root;
    delete process.env.HOME;
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_DATA_HOME;
  } else {
    process.env.HOME = root;
    process.env.XDG_CONFIG_HOME = join(root, "config");
    process.env.XDG_DATA_HOME = join(root, "data");
    delete process.env.LOCALAPPDATA;
  }
  for (const key of ["AGENT_BROWSER_PROFILE"]) {
    if (extra[key] === undefined) delete process.env[key];
    else process.env[key] = extra[key];
  }

  try {
    return await callback();
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test("returns the QR image and its saved path", async (t) => {
  if (!process.features?.typescript) {
    t.skip("Node runtime cannot load TypeScript extensions directly");
    return;
  }

  const root = mkdtempSync(join(tmpdir(), "pi-agent-browser-qr-"));
  try {
    await withBrowserEnvironment(root, async () => {
      const screenshotPath = join(root, "qr.png");
      writeFileSync(screenshotPath, "png");
      const agentBrowserExtension = await loadBrowserExtension();
      const pi = createFakePi();
      pi.execResult = { code: 0, stdout: `Screenshot saved to ${screenshotPath}`, stderr: "" };
      agentBrowserExtension(pi);

      const result = await runBrowserTool(pi, "qr");
      assert.ok(result.content[0].text.includes(`Saved: ${screenshotPath}`));
      assert.equal(result.content[1].type, "image");
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("renders a usable QR fallback when the terminal cannot display images", async (t) => {
  if (!process.features?.typescript) {
    t.skip("Node runtime cannot load TypeScript extensions directly");
    return;
  }

  const agentBrowserExtension = await loadBrowserExtension();
  const pi = createFakePi();
  agentBrowserExtension(pi);
  globalThis.__piBrowserTestCapabilities = { images: null };

  try {
    const rendered = pi.tool.renderResult(
      {
        content: [
          { type: "text", text: "QR code returned inline. Scan the image." },
          { type: "image", data: "cG5n", mimeType: "image/png" },
        ],
        details: { action: "qr", screenshotPath: "qr.png" }
      },
      { expanded: false, isPartial: false },
      { fg: (_color, text) => text },
      { showImages: true },
    );

    assert.match(rendered.args[0], /QR code saved: qr\.png/);
    assert.match(rendered.args[0], /cannot display inline images/);
  } finally {
    delete globalThis.__piBrowserTestCapabilities;
  }
});

test("uses the default profile when persistence has not been configured", async (t) => {
  if (!process.features?.typescript) {
    t.skip("Node runtime cannot load TypeScript extensions directly");
    return;
  }

  const root = mkdtempSync(join(tmpdir(), "pi-agent-browser-default-routing-"));
  try {
    await withBrowserEnvironment(root, async () => {
      const agentBrowserExtension = await loadBrowserExtension();
      const pi = createFakePi();
      agentBrowserExtension(pi);
      const profilePath = join(getPersistencePaths().profileRoot, "default");

      await runBrowserTool(pi, "open https://example.com");
      assert.deepEqual(pi.calls[0].args, ["--profile", profilePath, "open", "https://example.com"]);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("routes browser commands and shutdown through one named profile", async (t) => {
  if (!process.features?.typescript) {
    t.skip("Node runtime cannot load TypeScript extensions directly");
    return;
  }

  const root = mkdtempSync(join(tmpdir(), "pi-agent-browser-routing-"));
  try {
    await withBrowserEnvironment(root, async () => {
      const agentBrowserExtension = await loadBrowserExtension();
      const pi = createFakePi();
      agentBrowserExtension(pi);
      const paths = getPersistencePaths();
      const profilePath = join(paths.profileRoot, "work");

      const enabled = await runBrowserTool(pi, "persist on work");
      assert.equal(enabled.isError, undefined);
      assert.equal(pi.calls.length, 0);

      await runBrowserTool(pi, "open https://example.com");
      await runBrowserTool(pi, "qr --full");
      assert.deepEqual(pi.calls[0].args, ["--profile", profilePath, "open", "https://example.com"]);
      assert.deepEqual(pi.calls[1].args, ["--profile", profilePath, "screenshot", "--full"]);

      const override = await runBrowserTool(pi, "--profile other open https://example.com");
      assert.equal(override.isError, true);
      assert.equal(pi.calls.length, 2);

      await pi.events.get("session_shutdown")({}, {});
      assert.deepEqual(pi.calls[2].args, ["--profile", profilePath, "close"]);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("applies profile changes after close and leaves native profile overrides untouched", async (t) => {
  if (!process.features?.typescript) {
    t.skip("Node runtime cannot load TypeScript extensions directly");
    return;
  }

  const root = mkdtempSync(join(tmpdir(), "pi-agent-browser-switching-"));
  try {
    await withBrowserEnvironment(root, async () => {
      const agentBrowserExtension = await loadBrowserExtension();
      const pi = createFakePi();
      agentBrowserExtension(pi);
      const paths = getPersistencePaths();
      const workPath = join(paths.profileRoot, "work");
      const socialPath = join(paths.profileRoot, "social");

      await runBrowserTool(pi, "persist on work");
      await runBrowserTool(pi, "open https://example.com");
      await runBrowserTool(pi, "persist on social");
      await runBrowserTool(pi, "screenshot");
      assert.equal(pi.calls[1].args[1], workPath);

      await runBrowserTool(pi, "close");
      await runBrowserTool(pi, "open https://example.com");
      assert.deepEqual(pi.calls[3].args, ["--profile", socialPath, "open", "https://example.com"]);
      await runBrowserTool(pi, "close");
      await runBrowserTool(pi, "persist off");
      await runBrowserTool(pi, "open https://example.com");
      assert.deepEqual(pi.calls[5].args, ["open", "https://example.com"]);

      const nativePath = join(root, "native-profile");
      await withBrowserEnvironment(root, async () => {
        const nativePi = createFakePi();
        agentBrowserExtension(nativePi);
        const status = await runBrowserTool(nativePi, "persist status");
        assert.equal(status.content[0].text.includes(nativePath), false);
        await runBrowserTool(nativePi, "open https://example.com");
        assert.deepEqual(nativePi.calls[0].args, ["--profile", nativePath, "open", "https://example.com"]);
      }, { AGENT_BROWSER_PROFILE: nativePath });

    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
