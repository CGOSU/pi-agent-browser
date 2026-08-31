import { existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, join, resolve, win32 } from "node:path";

function pathApi(platform) {
  return platform === "win32" ? win32 : { join, resolve, dirname };
}

function pathEntries(env, platform) {
  const pathValue = env.PATH || "";
  const separator = platform === "win32" ? ";" : delimiter;
  return pathValue.split(separator).filter(Boolean);
}

function resolveWindowsShim(shimPath, platform) {
  if (platform !== "win32" || !shimPath.toLowerCase().endsWith(".cmd")) {
    return { command: shimPath, args: [] };
  }

  let source;
  try {
    source = readFileSync(shimPath, "utf8");
  } catch {
    return undefined;
  }

  const target = source.match(/"%~dp0([^\"]+)"/i)?.[1];
  if (!target) return undefined;
  const executable = resolve(dirname(shimPath), target);
  if (!existsSync(executable)) return undefined;
  return { command: executable, args: [] };
}

export function resolveAgentBrowser({ env = process.env, platform = process.platform } = {}) {
  const api = pathApi(platform);
  const names = platform === "win32"
    ? ["agent-browser.exe", "agent-browser.cmd", "agent-browser"]
    : ["agent-browser"];

  for (const directory of pathEntries(env, platform)) {
    for (const name of names) {
      const candidate = api.join(directory, name);
      if (!existsSync(candidate)) continue;
      const resolved = resolveWindowsShim(candidate, platform);
      if (resolved) return resolved;
    }
  }
  return undefined;
}

export function resolveAgentBrowserPath({ env = process.env, platform = process.platform } = {}) {
  const resolved = resolveAgentBrowser({ env, platform });
  return resolved?.command;
}

export function translateAgentBrowserCommand(parts) {
  return parts[0]?.toLowerCase() === "qr"
    ? ["screenshot", ...parts.slice(1)]
    : parts;
}

export function agentBrowserInstallHint(platform = process.platform) {
  const install = "npm install -g agent-browser && agent-browser install";
  return platform === "win32"
    ? `Install it from PowerShell: ${install}`
    : `Install it with: ${install}`;
}
