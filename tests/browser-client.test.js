import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  BrowserClient,
  browserConfigPath,
  discoverExecutable,
  resolveBrowserConfig,
} from "../extensions/browser-client.js";
import { ObscuraMcpClient } from "../extensions/obscura-mcp-client.js";

function missingConfigPath() {
  return join(tmpdir(), `pi-browser-config-missing-${process.pid}-${Date.now()}.json`);
}

function baseConfig(overrides = {}) {
  return {
    backend: "auto",
    obscura: { path: "", stealth: false, proxy: "", userAgent: "", allowPrivateNetwork: false },
    pinchtab: { path: "", server: "http://127.0.0.1:9867" },
    ...overrides,
  };
}

function fakeResult(text) {
  return { content: [{ type: "text", text }] };
}

test("computes platform user config paths without requiring environment variables", () => {
  assert.equal(
    browserConfigPath({ platform: "win32", home: "C:/Users/test", env: {} }).replaceAll("\\", "/"),
    "C:/Users/test/AppData/Roaming/pi-agent-browser/config.json",
  );
  assert.equal(
    browserConfigPath({ platform: "linux", home: "/home/test", env: {} }),
    "/home/test/.config/pi-agent-browser/config.json",
  );
  assert.equal(
    browserConfigPath({ platform: "linux", home: "/home/test", env: { XDG_CONFIG_HOME: "/etc/xdg" } }),
    "/etc/xdg/pi-agent-browser/config.json",
  );
  assert.equal(
    browserConfigPath({ platform: "win32", home: "C:/Users/test", env: { APPDATA: "C:/AppData" } }).replaceAll("\\", "/"),
    "C:/AppData/pi-agent-browser/config.json",
  );
});

test("defaults to the PinchTab Chrome backend", () => {
  const config = resolveBrowserConfig({
    configPath: missingConfigPath(),
    env: {},
    platform: "linux",
    home: "/home/test",
  });
  assert.equal(config.backend, "pinchtab");
});

test("merges user config and environment overrides, including false booleans", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-browser-config-"));
  const configPath = join(dir, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      backend: "obscura",
      obscura: {
        path: "C:/from-config/obscura.exe",
        stealth: true,
        proxy: "http://config-proxy",
        userAgent: "Config UA",
        allowPrivateNetwork: true,
      },
      pinchtab: { server: "http://config-pinchtab:9867" },
    }),
  );

  const config = resolveBrowserConfig({
    configPath,
    env: {
      PI_BROWSER_BACKEND: "pinchtab",
      PI_OBSCURA_STEALTH: "0",
      PI_OBSCURA_ALLOW_PRIVATE_NETWORK: "false",
      PI_OBSCURA_PROXY: "",
      PI_PINCHTAB_URL: "http://env-pinchtab:9867",
    },
    platform: "linux",
    home: "/home/test",
  });

  assert.equal(config.backend, "pinchtab");
  assert.equal(config.obscura.path, "C:/from-config/obscura.exe");
  assert.equal(config.obscura.stealth, false);
  assert.equal(config.obscura.allowPrivateNetwork, false);
  assert.equal(config.obscura.proxy, "");
  assert.equal(config.obscura.userAgent, "Config UA");
  assert.equal(config.pinchtab.server, "http://env-pinchtab:9867");
  assert.equal(config.pinchtab.installPolicy, "prompt");
});

test("validates malformed configuration and environment values", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-browser-invalid-config-"));
  const configPath = join(dir, "config.json");
  writeFileSync(configPath, JSON.stringify({ backend: "playwright" }));
  assert.throws(
    () => resolveBrowserConfig({ configPath, env: {}, platform: "linux", home: "/home/test" }),
    /invalid backend/,
  );

  writeFileSync(configPath, JSON.stringify({ obscura: { stealth: "yes" } }));
  assert.throws(
    () => resolveBrowserConfig({ configPath, env: {}, platform: "linux", home: "/home/test" }),
    /must be a boolean/,
  );

  assert.throws(
    () => resolveBrowserConfig({ configPath: missingConfigPath(), env: { PI_BROWSER_BACKEND: "chrome" } }),
    /PI_BROWSER_BACKEND/,
  );
  assert.throws(
    () => resolveBrowserConfig({ configPath: missingConfigPath(), env: { PI_OBSCURA_STEALTH: "maybe" } }),
    /PI_OBSCURA_STEALTH/,
  );
  assert.throws(
    () => resolveBrowserConfig({ configPath: missingConfigPath(), env: { PI_PINCHTAB_INSTALL_POLICY: "later" } }),
    /PI_PINCHTAB_INSTALL_POLICY/,
  );
});

test("discovers executables in PATH without recursive disk scanning", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-browser-bin-"));
  const executable = join(dir, "obscura.exe");
  writeFileSync(executable, "fixture");
  const pathSeparator = process.platform === "win32" ? ";" : ":";
  assert.equal(
    discoverExecutable("obscura", { platform: "win32", env: { PATH: `${dir}${pathSeparator}C:/missing` } }),
    executable,
  );
  assert.equal(discoverExecutable("missing", { platform: "linux", env: { PATH: dir } }), undefined);
});

test("auto selection is shared and browser commands are serialized", async () => {
  const events = [];
  let healthCalls = 0;
  const pinchtab = {
    async health() {
      healthCalls += 1;
      events.push("health");
    },
    async callCommand(command) {
      events.push(`pinchtab:${command}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { action: "open", tool: "/navigate", result: fakeResult(command) };
    },
    async close() {},
  };
  const obscura = {
    async ensureReady() {
      throw new Error("Obscura should not be probed after PinchTab is ready");
    },
    async callTool() {
      throw new Error("Obscura should not receive calls");
    },
    async close() {},
  };
  const client = new BrowserClient({
    config: baseConfig(),
    pinchtabClient: pinchtab,
    obscuraClient: obscura,
  });

  const results = await Promise.all([client.execute("open https://one.test"), client.execute("open https://two.test")]);
  assert.equal(healthCalls, 1);
  assert.deepEqual(results.map((result) => result.backend), ["pinchtab", "pinchtab"]);
  assert.deepEqual(events, ["health", "pinchtab:open https://one.test", "pinchtab:open https://two.test"]);
  assert.equal(client.selectedBackend, "pinchtab");
});

test("auto selection falls back before dispatch when PinchTab health fails", async () => {
  let pinchtabCalls = 0;
  let obscuraCalls = 0;
  const client = new BrowserClient({
    config: baseConfig(),
    pinchtabClient: {
      async health() {
        throw new Error("connection refused");
      },
      async callCommand() {
        pinchtabCalls += 1;
        return { result: fakeResult("unexpected") };
      },
      async close() {},
    },
    obscuraClient: {
      async ensureReady() {
        obscuraCalls += 1;
      },
      async callTool(name, args) {
        obscuraCalls += 1;
        return fakeResult(JSON.stringify({ name, args }));
      },
      async close() {},
    },
  });

  const result = await client.execute("open https://fallback.test");
  assert.equal(result.backend, "obscura");
  assert.equal(pinchtabCalls, 0);
  assert.equal(obscuraCalls, 2);
  assert.equal(client.selectedBackend, "obscura");
});

test("a dispatched PinchTab failure is not replayed on Obscura", async () => {
  let pinchtabCalls = 0;
  let obscuraCalls = 0;
  const client = new BrowserClient({
    config: baseConfig(),
    pinchtabClient: {
      async health() {},
      async callCommand() {
        pinchtabCalls += 1;
        throw new Error("action failed after dispatch");
      },
      async close() {},
    },
    obscuraClient: {
      async ensureReady() {
        throw new Error("must not probe after PinchTab selection");
      },
      async callTool() {
        obscuraCalls += 1;
        return fakeResult("replayed");
      },
      async close() {},
    },
  });

  await assert.rejects(client.execute("click @e1"), /action failed after dispatch/);
  assert.equal(pinchtabCalls, 1);
  assert.equal(obscuraCalls, 0);
  assert.equal(client.selectedBackend, "pinchtab");
});

test("explicit backend mode does not silently switch backends", async () => {
  let obscuraCalls = 0;
  const client = new BrowserClient({
    config: baseConfig({ backend: "pinchtab" }),
    pinchtabClient: {
      async health() {
        throw new Error("PinchTab is not running");
      },
      async callCommand() {
        throw new Error("should not dispatch");
      },
      async close() {},
    },
    obscuraClient: {
      async ensureReady() {
        obscuraCalls += 1;
      },
      async close() {},
    },
  });
  await assert.rejects(client.execute("open https://example.test"), /PinchTab is not running/);
  assert.equal(obscuraCalls, 0);
});

test("Obscura startup timeout is finite by default", () => {
  const client = new ObscuraMcpClient({ defaultTimeout: 60_000 });
  assert.ok(client.startupTimeout > 0);
  assert.ok(client.startupTimeout <= 10_000);
});
