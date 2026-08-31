import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  disablePersistence,
  enablePersistence,
  getPersistencePaths,
  getPersistenceStatus,
  readPersistenceConfig,
  resolveBrowserProfile,
  validateProfileName,
} from "../extensions/persistence.js";

function windowsEnv(root, extra = {}) {
  return {
    LOCALAPPDATA: root,
    ...extra,
  };
}

test("builds separate Windows config and local profile paths", () => {
  const paths = getPersistencePaths({
    platform: "win32",
    env: { LOCALAPPDATA: "C:\\Users\\alice\\AppData\\Local" },
  });

  assert.equal(paths.configPath, "C:\\Users\\alice\\AppData\\Local\\pi-agent-browser\\config.json");
  assert.equal(paths.profileRoot, "C:\\Users\\alice\\AppData\\Local\\pi-agent-browser\\profiles");
});

test("builds XDG config and data paths on POSIX", () => {
  const paths = getPersistencePaths({
    platform: "linux",
    env: {
      HOME: "/home/alice",
      XDG_CONFIG_HOME: "/config",
      XDG_DATA_HOME: "/data",
    },
  });

  assert.equal(paths.configPath, "/config/pi-agent-browser/config.json");
  assert.equal(paths.profileRoot, "/data/pi-agent-browser/profiles");
});

test("rejects unsafe profile names", () => {
  for (const name of ["", " ", " Work", "work ", "../work", "work/name", "work\\name", ".", "..", "A", "a_b", "a--b", "a-"]) {
    assert.throws(() => validateProfileName(name), /Profile name must be/);
  }

  assert.equal(validateProfileName("work-1"), "work-1");
});

test("enables and disables a named profile without deleting its data", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-agent-browser-persistence-"));
  const env = windowsEnv(root);
  try {
    const enabled = enablePersistence("work", { platform: "win32", env });
    assert.equal(existsSync(enabled.profilePath), true);
    assert.deepEqual(getPersistenceStatus({ platform: "win32", env }), {
      enabled: true,
      source: "config",
      profileName: "work",
    });
    assert.equal(readFileSync(getPersistencePaths({ platform: "win32", env }).configPath, "utf8"), '{"profile":"work"}\n');

    writeFileSync(join(enabled.profilePath, "session-marker"), "kept");
    disablePersistence({ platform: "win32", env });

    assert.equal(existsSync(join(enabled.profilePath, "session-marker")), true);
    assert.deepEqual(getPersistenceStatus({ platform: "win32", env }), {
      enabled: false,
      source: "none",
    });
    assert.deepEqual(readPersistenceConfig({ platform: "win32", env }), { profile: undefined });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("native AGENT_BROWSER_PROFILE overrides the named profile without leaking its path in status", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-agent-browser-native-profile-"));
  const configuredEnv = windowsEnv(root);
  const nativePath = join(root, "native-profile");
  try {
    enablePersistence("work", { platform: "win32", env: configuredEnv });
    const env = windowsEnv(root, { AGENT_BROWSER_PROFILE: nativePath });

    assert.deepEqual(resolveBrowserProfile({ platform: "win32", env }), {
      source: "environment",
      profilePath: nativePath,
    });
    const status = getPersistenceStatus({ platform: "win32", env });
    assert.deepEqual(status, { enabled: true, source: "environment" });
    assert.equal(JSON.stringify(status).includes(nativePath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reports a corrupted persistence config instead of silently resetting it", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-agent-browser-corrupt-config-"));
  const env = windowsEnv(root);
  try {
    const configPath = getPersistencePaths({ platform: "win32", env }).configPath;
    const configDir = join(root, "pi-agent-browser");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(configPath, '{"profile":"../secret"}');

    assert.throws(
      () => readPersistenceConfig({ platform: "win32", env }),
      /Invalid pi-agent-browser persistence config/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
