import { spawn } from "node:child_process";
import { installPinchtab, pinchtabDownloadUrl } from "./pinchtab-installer.js";
import { parseCommand } from "./obscura-mcp-client.js";

export const DEFAULT_PINCHTAB_SERVER = "http://127.0.0.1:9867";
const DEFAULT_TIMEOUT = 60_000;
const STARTUP_TIMEOUT = 10_000;
const STARTUP_POLL_MS = 100;
const MAX_WAIT_MS = 30_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isConnectionFailure(error) {
  return error?.message?.startsWith("PinchTab request failed:");
}

function startupError(error, state) {
  const detail = state?.stderr?.trim();
  return new Error(
    `PinchTab failed to start: ${detail || error?.message || "server did not become healthy"}`,
  );
}

function manualInstallHint(platform, arch) {
  let url;
  try {
    url = pinchtabDownloadUrl(platform, arch);
  } catch {
    url = "https://github.com/pinchtab/pinchtab/releases";
  }
  return `Download PinchTab from ${url}, then set PI_PINCHTAB_PATH to the downloaded executable.`;
}

function normalizeRef(value) {
  return value.startsWith("@") ? value.slice(1) : value;
}

function targetSelector(value) {
  return normalizeRef(value);
}

function withTabId(payload, tabId) {
  return tabId ? { ...payload, tabId } : payload;
}

function queryWithTab(query, tabId) {
  return tabId ? { ...query, tabId } : query;
}

function requireParts(parts, count, usage) {
  if (parts.length < count) {
    throw new Error(`Usage: ${usage}`);
  }
}

function finiteNumber(value, message) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0) {
    throw new Error(message);
  }
  return result;
}

function pathForTab(path, tabId) {
  return tabId ? `/tabs/${encodeURIComponent(tabId)}${path}` : path;
}

function responseTabId(value) {
  if (!value || typeof value !== "object") return undefined;
  return typeof value.tabId === "string" && value.tabId ? value.tabId : undefined;
}

export function commandToPinchtabCall(command, state = {}) {
  const parts = parseCommand(command.trim());
  if (parts.length === 0) {
    throw new Error("A browser command is required.");
  }

  const action = parts[0].toLowerCase();
  const tabId = state.tabId;

  switch (action) {
    case "open":
    case "goto":
    case "navigate": {
      requireParts(parts, 2, `${action} <url>`);
      return {
        action: "navigate",
        method: "POST",
        path: "/navigate",
        body: withTabId({ url: parts[1] }, tabId),
      };
    }

    case "snapshot": {
      const interactive = parts.slice(1).some((part) => part === "-i" || part === "--interactive");
      if (parts.slice(1).some((part) => !["-i", "--interactive"].includes(part))) {
        throw new Error("Usage: snapshot [-i|--interactive]");
      }
      return {
        action: "snapshot",
        method: "GET",
        path: "/snapshot",
        query: queryWithTab(interactive ? { interactive: "true" } : {}, tabId),
      };
    }

    case "click":
      requireParts(parts, 2, "click <@ref|selector>");
      return {
        action: "click",
        method: "POST",
        path: "/action",
        body: withTabId({ kind: "click", selector: targetSelector(parts[1]) }, tabId),
      };

    case "fill":
      requireParts(parts, 3, "fill <@ref|selector> <text>");
      return {
        action: "fill",
        method: "POST",
        path: "/action",
        body: withTabId({ kind: "fill", selector: targetSelector(parts[1]), text: parts.slice(2).join(" ") }, tabId),
      };

    case "type":
      requireParts(parts, 3, "type <@ref|selector> <text>");
      return {
        action: "type",
        method: "POST",
        path: "/action",
        body: withTabId({ kind: "type", selector: targetSelector(parts[1]), text: parts.slice(2).join(" ") }, tabId),
      };

    case "select":
      requireParts(parts, 3, "select <@ref|selector> <value>");
      return {
        action: "select",
        method: "POST",
        path: "/action",
        body: withTabId({ kind: "select", selector: targetSelector(parts[1]), value: parts.slice(2).join(" ") }, tabId),
      };

    case "press":
      requireParts(parts, 2, "press <key>");
      return {
        action: "press",
        method: "POST",
        path: "/action",
        body: withTabId({ kind: "press", key: parts[1] }, tabId),
      };

    case "scroll": {
      const direction = parts[1] || "down";
      const allowed = new Set(["top", "bottom", "up", "down", "left", "right"]);
      if (!allowed.has(direction)) {
        throw new Error(`Unknown scroll direction: ${direction}`);
      }
      const body = { kind: "scroll", direction };
      if (parts[2] !== undefined) {
        body.pixels = finiteNumber(parts[2], "Scroll amount must be a non-negative number.");
      }
      return { action: "scroll", method: "POST", path: "/action", body: withTabId(body, tabId) };
    }

    case "get": {
      requireParts(parts, 2, "get <text|url|title|html|value|attr> [name] [@ref|selector]");
      const what = parts[1].toLowerCase();
      if (what === "text" || what === "html" || what === "value") {
        const query = {};
        if (parts[2]) query[/^e\d+$/.test(normalizeRef(parts[2])) ? "ref" : "selector"] = targetSelector(parts[2]);
        return {
          action: "get",
          method: "GET",
          path: `/${what}`,
          query: queryWithTab(query, tabId),
        };
      }
      if (what === "attr") {
        requireParts(parts, 3, "get attr <name> [@ref|selector]");
        const target = parts[3];
        const query = {
          name: parts[2],
          [/^e\d+$/.test(normalizeRef(target)) ? "ref" : "selector"]: targetSelector(target),
        };
        return { action: "get", method: "GET", path: "/attr", query: queryWithTab(query, tabId) };
      }
      if (what === "url" || what === "title") {
        if (parts[2]) {
          throw new Error(`get ${what} does not accept an element reference.`);
        }
        return { action: "get", method: "GET", path: `/${what}`, query: queryWithTab({}, tabId) };
      }
      throw new Error(`Unknown get target: ${what}`);
    }

    case "wait": {
      requireParts(parts, 2, "wait <@ref|selector|milliseconds>");
      if (/^\d+$/.test(parts[1])) {
        const ms = finiteNumber(parts[1], "Wait duration must be a non-negative number.");
        if (ms > MAX_WAIT_MS) {
          throw new Error(`PinchTab wait is limited to ${MAX_WAIT_MS}ms.`);
        }
        return { action: "wait", method: "POST", path: "/wait", body: withTabId({ ms }, tabId) };
      }
      return {
        action: "wait",
        method: "POST",
        path: "/wait",
        body: withTabId({ selector: targetSelector(parts[1]) }, tabId),
      };
    }

    case "screenshot": {
      const full = parts.slice(1).some((part) => part === "--full");
      if (parts.slice(1).some((part) => part !== "--full")) {
        throw new Error("Usage: screenshot [--full]");
      }
      return {
        action: "screenshot",
        method: "GET",
        path: "/screenshot",
        query: queryWithTab({ format: "png", output: "inline", ...(full ? { beyondViewport: "true" } : {}) }, tabId),
      };
    }

    case "eval":
      requireParts(parts, 2, "eval <javascript>");
      return {
        action: "eval",
        method: "POST",
        path: "/evaluate",
        body: withTabId({ expression: parts.slice(1).join(" ") }, tabId),
      };

    case "back":
    case "forward":
    case "reload":
      return { action, method: "POST", path: pathForTab(`/${action}`, tabId) };

    case "tab": {
      const subcommand = parts[1] || "list";
      if (subcommand === "new") {
        return {
          action: "tab",
          method: "POST",
          path: "/tab",
          body: parts[2] ? { action: "new", url: parts[2] } : { action: "new" },
        };
      }
      if (subcommand === "list") {
        return { action: "tab", method: "GET", path: "/tabs" };
      }
      if (subcommand === "close") {
        const target = parts[2] || tabId;
        return {
          action: "tab",
          method: "POST",
          path: "/close",
          body: target ? { tabId: normalizeRef(target) } : {},
        };
      }
      if (subcommand === "switch") {
        requireParts(parts, 3, "tab switch <tab-id>");
        return { action: "tab", method: "POST", path: "/tab", body: { action: "focus", tabId: normalizeRef(parts[2]) } };
      }
      if (/^\d+$/.test(subcommand)) {
        return { action: "tab-index", index: Number(subcommand) };
      }
      throw new Error("Usage: tab [new [url]|list|close [tab-id]|switch <tab-id>]");
    }

    case "close":
      return {
        action: "close",
        method: "POST",
        path: "/close",
        body: tabId ? { tabId } : {},
      };

    default:
      throw new Error(`Unsupported PinchTab browser command: ${parts[0]}`);
  }
}

function contentText(data, rawText) {
  if (typeof data === "string") return data;
  if (data === undefined || data === null) return rawText || "(no output)";
  return JSON.stringify(data);
}

function imageContent(data) {
  if (!data || typeof data !== "object" || typeof data.base64 !== "string" || !data.base64) {
    return null;
  }
  const format = typeof data.format === "string" && data.format.toLowerCase() === "png" ? "png" : "jpeg";
  return { type: "image", data: data.base64, mimeType: `image/${format}` };
}

function formatErrorBody(text) {
  if (!text) return "";
  try {
    const parsed = JSON.parse(text);
    if (parsed?.error) return typeof parsed.error === "string" ? parsed.error : JSON.stringify(parsed.error);
    if (parsed?.message) return String(parsed.message);
    return JSON.stringify(parsed);
  } catch {
    return text.slice(0, 500);
  }
}

export function pinchtabServerUrl(value = DEFAULT_PINCHTAB_SERVER) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid PinchTab server URL: ${value}`);
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw new Error(`PinchTab server URL must use http or https: ${value}`);
  }
  return url.toString().replace(/\/$/, "");
}

export class PinchtabClient {
  constructor(options = {}) {
    this.server = pinchtabServerUrl(options.server || DEFAULT_PINCHTAB_SERVER);
    this.env = options.env || process.env;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    if (typeof this.fetchImpl !== "function") {
      throw new Error("PinchTab requires a fetch implementation (Node.js 20 or newer).");
    }
    this.defaultTimeout = options.defaultTimeout || DEFAULT_TIMEOUT;
    this.startupTimeout = options.startupTimeout || STARTUP_TIMEOUT;
    this.executable = options.executable;
    this.installPolicy = options.installPolicy || "prompt";
    this.installImpl = options.installImpl || installPinchtab;
    this.spawnImpl = options.spawnImpl || spawn;
    this.platform = options.platform || process.platform;
    this.arch = options.arch || process.arch;
    this.tabId = options.tabId;
    this.lastRequest = null;
    this.serverProcess = undefined;
    this.startPromise = undefined;
  }

  async health(options = {}) {
    try {
      await this.request("GET", "/health", options);
      return true;
    } catch (error) {
      if (!isConnectionFailure(error)) throw error;
      await this.startServer(options);
      await this.waitForHealth(options);
      return true;
    }
  }

  async startServer(options = {}) {
    if (this.serverProcess && !this.serverProcess.exited) return;
    if (!this.executable && this.installPolicy === "always" && this.server === DEFAULT_PINCHTAB_SERVER) {
      try {
        this.executable = await this.installImpl({ env: this.env, platform: this.platform, arch: this.arch });
      } catch (error) {
        throw new Error(`${error?.message || String(error)} ${manualInstallHint(this.platform, this.arch)}`);
      }
    }
    if (!this.executable) {
      const installHint = this.server === DEFAULT_PINCHTAB_SERVER
        ? manualInstallHint(this.platform, this.arch)
        : `start the PinchTab service at ${this.server}`;
      throw new Error(`PinchTab is not running at ${this.server}. ${installHint}`);
    }
    if (!this.startPromise) {
      this.startPromise = this.spawnServer()
        .finally(() => {
          this.startPromise = undefined;
        });
    }
    await this.startPromise;
  }

  async spawnServer() {
    let child;
    try {
      child = this.spawnImpl(this.executable, ["server"], {
        env: this.env,
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
        shell: this.platform === "win32" && this.executable.toLowerCase().endsWith(".cmd"),
      });
    } catch (error) {
      throw startupError(error);
    }

    const state = { child, stderr: "", exited: false };
    this.serverProcess = state;
    child.stderr?.setEncoding?.("utf8");
    child.stderr?.on?.("data", (chunk) => {
      state.stderr = `${state.stderr}${chunk}`.slice(-2_000);
    });
    child.once?.("exit", (code, signal) => {
      state.exited = true;
      state.exit = { code, signal };
    });

    await new Promise((resolve, reject) => {
      let settled = false;
      const resolveOnce = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const rejectOnce = (error) => {
        if (settled) return;
        settled = true;
        reject(startupError(error, state));
      };
      child.once?.("spawn", resolveOnce);
      child.once?.("error", rejectOnce);
      if (typeof child.once !== "function") resolveOnce();
    });
  }

  async waitForHealth(options = {}) {
    const timeout = Math.max(1, Number(options.timeout) || this.startupTimeout);
    const deadline = Date.now() + timeout;
    let lastError;
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      if (this.serverProcess?.exited) throw startupError(lastError, this.serverProcess);
      try {
        await this.request("GET", "/health", {
          ...options,
          timeout: Math.min(1_000, remaining),
        });
        return true;
      } catch (error) {
        lastError = error;
        if (!isConnectionFailure(error)) throw error;
      }
      await sleep(Math.min(STARTUP_POLL_MS, Math.max(1, deadline - Date.now())));
    }
    throw startupError(lastError, this.serverProcess);
  }

  async callCommand(command, options = {}) {
    const call = commandToPinchtabCall(command, { tabId: this.tabId });
    if (call.action === "tab-index") {
      const tabsResponse = await this.request("GET", "/tabs", options);
      const tabs = Array.isArray(tabsResponse.data?.tabs) ? tabsResponse.data.tabs : [];
      const tab = tabs[call.index - 1];
      if (!tab?.id) {
        throw new Error(`PinchTab tab index not found: ${call.index}`);
      }
      const focused = await this.request("POST", "/tab", {
        ...options,
        body: { action: "focus", tabId: tab.id },
      });
      this.tabId = tab.id;
      return this.result(call, focused);
    }

    if (call.action === "close" && !this.tabId && !call.body?.tabId) {
      return this.result(call, { data: { closed: false, message: "No active PinchTab tab." }, text: "" });
    }

    const response = await this.request(call.method, call.path, {
      ...options,
      query: call.query,
      body: call.body,
    });

    const returnedTabId = responseTabId(response.data);
    if (returnedTabId) this.tabId = returnedTabId;
    if (call.action === "tab" && call.body?.action === "focus") this.tabId = call.body.tabId;
    if ((call.action === "tab" || call.action === "close") && call.body?.tabId === this.tabId && call.body?.action !== "focus") {
      this.tabId = undefined;
    }

    return this.result(call, response);
  }

  result(call, response) {
    const image = call.action === "screenshot" ? imageContent(response.data) : null;
    const content = [];
    if (image) content.push(image);
    if (!image || response.data?.annotations || response.data?.tabId || response.data?.url) {
      content.unshift({ type: "text", text: contentText(response.data, response.text) });
    }
    if (content.length === 0) content.push({ type: "text", text: contentText(response.data, response.text) });
    return { action: call.action, tool: call.path, result: { content } };
  }

  async request(method, path, options = {}) {
    const url = new URL(path, `${this.server}/`);
    for (const [key, value] of Object.entries(options.query || {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }

    const controller = new AbortController();
    const timeout = options.timeout || this.defaultTimeout;
    const timer = setTimeout(() => controller.abort(new Error(`PinchTab request timed out after ${timeout}ms.`)), timeout);
    const onAbort = () => controller.abort(options.signal.reason || new Error("PinchTab request cancelled."));
    if (options.signal) {
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener("abort", onAbort, { once: true });
    }

    const headers = { accept: "application/json" };
    const session = this.env.PINCHTAB_SESSION;
    const token = this.env.PINCHTAB_TOKEN;
    if (session) headers.authorization = `Session ${session}`;
    else if (token) headers.authorization = `Bearer ${token}`;

    let response;
    let text;
    try {
      const body = options.body === undefined ? undefined : JSON.stringify(options.body);
      if (body !== undefined) headers["content-type"] = "application/json";
      this.lastRequest = { method, url: url.toString(), body: options.body };
      response = await this.fetchImpl(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      });
      text = await response.text();
    } catch (error) {
      if (controller.signal.aborted) {
        const reason = controller.signal.reason;
        if (reason?.message?.includes("timed out")) throw reason;
        throw new Error("PinchTab request cancelled.");
      }
      throw new Error(`PinchTab request failed: ${error?.message || String(error)}`);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    }

    let data = text;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        // Plain text responses are valid for /text and diagnostics.
      }
    }
    if (!response.ok) {
      const detail = formatErrorBody(text);
      throw new Error(`PinchTab ${method} ${path} failed (${response.status})${detail ? `: ${detail}` : ""}`);
    }
    return { status: response.status, data, text };
  }

  async close() {
    this.tabId = undefined;
    await this.startPromise?.catch(() => undefined);
    const state = this.serverProcess;
    this.serverProcess = undefined;
    if (!state || state.exited || typeof state.child.kill !== "function") return;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 1_000);
      state.child.once?.("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      state.child.kill();
      if (state.exited) {
        clearTimeout(timer);
        resolve();
      }
    });
  }
}
