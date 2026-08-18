import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT = 60_000;

function isEnabled(value) {
  return value === "1" || value === "true" || value === "yes";
}

function normalizeRef(value) {
  return value.startsWith("@") ? value.slice(1) : value;
}

function refSelector(value) {
  const ref = normalizeRef(value);
  if (!/^e\d+$/.test(ref)) {
    return value;
  }
  return `[data-obscura-ref="${ref}"]`;
}

function targetArguments(value) {
  const ref = normalizeRef(value);
  return /^e\d+$/.test(ref) ? { ref } : { selector: value };
}

function requireParts(parts, count, usage) {
  if (parts.length < count) {
    throw new Error(`Usage: ${usage}`);
  }
}

function evaluateSelector(selector, expression) {
  return `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? ${expression} : null; })()`;
}

export function parseCommand(command) {
  const args = [];
  let current = "";
  let quote = null;
  let hasValue = false;

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];

    if (quote === '"' && char === "\\" && (command[i + 1] === '"' || command[i + 1] === "\\")) {
      current += command[++i];
      hasValue = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
        hasValue = true;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      hasValue = true;
    } else if (/\s/.test(char)) {
      if (hasValue) {
        args.push(current);
        current = "";
        hasValue = false;
      }
    } else {
      current += char;
      hasValue = true;
    }
  }

  if (hasValue) {
    args.push(current);
  }

  return args;
}

export function commandToMcpCall(command) {
  const parts = parseCommand(command.trim());
  if (parts.length === 0) {
    throw new Error("A browser command is required.");
  }

  const action = parts[0].toLowerCase();
  const selector = (value) => refSelector(value);

  switch (action) {
    case "open":
    case "goto":
    case "navigate": {
      requireParts(parts, 2, `${action} <url>`);
      return { action: "navigate", tool: "browser_navigate", arguments: { url: parts[1] } };
    }

    case "snapshot": {
      const interactive = parts.slice(1).some((part) => part === "-i" || part === "--interactive");
      if (parts.slice(1).some((part) => !["-i", "--interactive"].includes(part))) {
        throw new Error("Usage: snapshot [-i|--interactive]");
      }
      return interactive
        ? { action: "snapshot", tool: "browser_interactive_elements", arguments: {} }
        : { action: "snapshot", tool: "browser_snapshot", arguments: {} };
    }

    case "click":
      requireParts(parts, 2, "click <@ref|selector>");
      return { action: "click", tool: "browser_click", arguments: targetArguments(parts[1]) };

    case "fill":
      requireParts(parts, 3, "fill <@ref|selector> <text>");
      return {
        action: "fill",
        tool: "browser_fill",
        arguments: { ...targetArguments(parts[1]), value: parts.slice(2).join(" ") },
      };

    case "type":
      requireParts(parts, 3, "type <@ref|selector> <text>");
      return {
        action: "type",
        tool: "browser_type",
        arguments: { ...targetArguments(parts[1]), text: parts.slice(2).join(" ") },
      };

    case "select":
      requireParts(parts, 3, "select <@ref|selector> <value>");
      return {
        action: "select",
        tool: "browser_select_option",
        arguments: { selector: selector(parts[1]), value: parts.slice(2).join(" ") },
      };

    case "press":
      requireParts(parts, 2, "press <key>");
      return { action: "press", tool: "browser_press_key", arguments: { key: parts[1] } };

    case "scroll": {
      const direction = parts[1] || "down";
      const allowed = new Set(["top", "bottom", "up", "down", "left", "right"]);
      if (!allowed.has(direction)) {
        throw new Error(`Unknown scroll direction: ${direction}`);
      }
      const amount = parts[2] === undefined ? undefined : Number(parts[2]);
      if (parts[2] !== undefined && (!Number.isFinite(amount) || amount < 0)) {
        throw new Error("Scroll amount must be a non-negative number.");
      }
      return {
        action: "scroll",
        tool: "browser_scroll",
        arguments: amount === undefined ? { direction } : { direction, amount },
      };
    }

    case "get": {
      requireParts(parts, 2, "get <text|url|title|html|value|attr> [@ref|selector]");
      const what = parts[1].toLowerCase();
      const valueTarget = parts[2] ? selector(parts[2]) : "body";

      if (what === "text") {
        return {
          action: "get",
          tool: "browser_evaluate",
          arguments: { expression: evaluateSelector(valueTarget, "el.innerText ?? el.textContent ?? \"\"") },
        };
      }
      if (what === "html") {
        return {
          action: "get",
          tool: "browser_evaluate",
          arguments: { expression: evaluateSelector(valueTarget, "el.outerHTML") },
        };
      }
      if (what === "value") {
        return {
          action: "get",
          tool: "browser_evaluate",
          arguments: { expression: evaluateSelector(valueTarget, "el.value ?? \"\"") },
        };
      }
      if (what === "attr") {
        requireParts(parts, 3, "get attr <name> [@ref|selector]");
        const attrTarget = parts[3] ? selector(parts[3]) : "body";
        return {
          action: "get",
          tool: "browser_get_attribute",
          arguments: { selector: attrTarget, attribute: parts[2] },
        };
      }
      if (what === "url" || what === "title") {
        if (parts[2]) {
          throw new Error(`get ${what} does not accept an element reference.`);
        }
        return {
          action: "get",
          tool: "browser_evaluate",
          arguments: { expression: what === "url" ? "location.href" : "document.title" },
        };
      }
      throw new Error(`Unknown get target: ${what}`);
    }

    case "wait": {
      requireParts(parts, 2, "wait <@ref|selector|milliseconds>");
      if (/^\d+$/.test(parts[1])) {
        return { action: "wait", localWaitMs: Number(parts[1]) };
      }
      return {
        action: "wait",
        tool: "browser_wait_for",
        arguments: { selector: selector(parts[1]) },
      };
    }

    case "screenshot": {
      if (parts.slice(1).some((part) => part === "--full")) {
        throw new Error("Obscura MCP currently supports viewport screenshots only; --full is unavailable.");
      }
      if (parts.length > 1) {
        throw new Error("Usage: screenshot [--full]");
      }
      return { action: "screenshot", tool: "browser_screenshot", arguments: {} };
    }

    case "eval":
      requireParts(parts, 2, "eval <javascript>");
      return { action: "eval", tool: "browser_evaluate", arguments: { expression: parts.slice(1).join(" ") } };

    case "back":
      return { action: "back", tool: "browser_back", arguments: {} };

    case "forward":
      return { action: "forward", tool: "browser_forward", arguments: {} };

    case "reload":
      return { action: "reload", tool: "browser_reload", arguments: {} };

    case "tab": {
      const subcommand = parts[1] || "list";
      if (subcommand === "new") {
        return {
          action: "tab",
          tool: "browser_tab_new",
          arguments: parts[2] ? { url: parts[2] } : {},
        };
      }
      if (subcommand === "list") {
        return { action: "tab", tool: "browser_tab_list", arguments: {} };
      }
      if (subcommand === "close") {
        return { action: "tab", tool: "browser_tab_close", arguments: parts[2] ? { tab_id: parts[2] } : {} };
      }
      if (subcommand === "switch") {
        requireParts(parts, 3, "tab switch <tab-id>");
        return { action: "tab", tool: "browser_tab_switch", arguments: { tab_id: parts[2] } };
      }
      if (/^\d+$/.test(subcommand)) {
        return { action: "tab", tool: "browser_tab_switch", arguments: { tab_id: `tab-${subcommand}` } };
      }
      throw new Error("Usage: tab [new [url]|list|close [tab-id]|switch <tab-id>]");
    }

    case "close":
      return { action: "close", tool: "browser_close", arguments: {} };

    default:
      throw new Error(`Unsupported Obscura browser command: ${parts[0]}`);
  }
}

function mcpErrorMessage(response) {
  if (response?.error?.message) {
    return response.error.message;
  }
  return "MCP request failed";
}

function resultText(result) {
  return (result?.content || [])
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
}

export function mcpResultToPiContent(result) {
  const content = [];
  const text = resultText(result);
  if (text) {
    content.push({ type: "text", text });
  }

  for (const item of result?.content || []) {
    if (item?.type === "image" && typeof item.data === "string" && typeof item.mimeType === "string") {
      content.push({ type: "image", data: item.data, mimeType: item.mimeType });
    }
  }

  if (content.length === 0) {
    content.push({ type: "text", text: "(no output)" });
  }
  return content;
}

export function obscuraLaunchArgs(env = process.env) {
  const args = ["mcp"];
  if (isEnabled(env.PI_OBSCURA_STEALTH)) args.push("--stealth");
  if (env.PI_OBSCURA_PROXY) args.push("--proxy", env.PI_OBSCURA_PROXY);
  if (env.PI_OBSCURA_USER_AGENT) args.push("--user-agent", env.PI_OBSCURA_USER_AGENT);
  if (isEnabled(env.PI_OBSCURA_ALLOW_PRIVATE_NETWORK)) args.push("--allow-private-network");
  return args;
}

export function obscuraExecutable(env = process.env, platform = process.platform) {
  return env.PI_OBSCURA_PATH || (platform === "win32" ? "obscura.exe" : "obscura");
}

export class ObscuraMcpClient {
  constructor(options = {}) {
    this.executable = options.executable || obscuraExecutable(options.env, options.platform || process.platform);
    this.args = options.args || obscuraLaunchArgs(options.env || process.env);
    this.cwd = options.cwd;
    this.env = { ...(options.env || process.env) };
    this.spawnImpl = options.spawnImpl || spawn;
    this.defaultTimeout = options.defaultTimeout || DEFAULT_TIMEOUT;
    this.startupTimeout = options.startupTimeout || Math.min(this.defaultTimeout, 10_000);
    this.child = null;
    this.readyPromise = null;
    this.pending = new Map();
    this.nextId = 1;
    this.queue = Promise.resolve();
    this.buffer = "";
  }

  async callTool(name, arguments_, options = {}) {
    const run = async () => {
      if (options.signal?.aborted) {
        throw new Error("Browser command cancelled.");
      }
      await this.ensureReady(options.signal, options.startupTimeout || this.startupTimeout);
      const response = await this.request(
        "tools/call",
        { name, arguments: arguments_ || {} },
        options,
      );
      if (response.error) {
        throw new Error(mcpErrorMessage(response));
      }
      if (response.result?.isError) {
        throw new Error(resultText(response.result) || "Obscura browser tool failed.");
      }
      return response.result || { content: [] };
    };

    const next = this.queue.catch(() => undefined).then(run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  async close() {
    this.stop(new Error("Obscura browser closed."));
    await this.queue.catch(() => undefined);
  }

  async ensureReady(signal, timeout = this.startupTimeout) {
    if (this.readyPromise) {
      return this.readyPromise;
    }

    this.readyPromise = (async () => {
      this.start();
      const response = await this.request(
        "initialize",
        {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "pi-agent-browser", version: "0.1.0" },
        },
        { signal, timeout },
      );
      if (response.error) {
        throw new Error(mcpErrorMessage(response));
      }
      this.notify("notifications/initialized", {});
    })().catch((error) => {
      this.stop(error);
      throw this.decorateError(error);
    });

    return this.readyPromise;
  }

  start() {
    if (this.child) {
      return;
    }

    let child;
    try {
      child = this.spawnImpl(this.executable, this.args, {
        cwd: this.cwd,
        env: this.env,
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      throw this.decorateError(error);
    }

    this.child = child;
    this.buffer = "";
    child.stdout?.setEncoding?.("utf8");
    child.stderr?.setEncoding?.("utf8");
    child.stdout?.on("data", (chunk) => this.readOutput(String(chunk)));
    child.stderr?.on("data", () => undefined);
    child.on("error", (error) => {
      if (this.child === child) {
        this.stop(this.decorateError(error));
      }
    });
    child.on("exit", (code, signal) => {
      if (this.child === child) {
        this.stop(new Error(`Obscura exited before completing the request (code=${code}, signal=${signal || "none"}).`));
      }
    });
  }

  readOutput(chunk) {
    this.buffer += chunk;
    let newline;
    while ((newline = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;

      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.id === undefined || message.id === null) continue;
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      pending.finish(() => pending.resolve(message));
    }
  }

  notify(method, params) {
    if (!this.child?.stdin?.writable) {
      throw new Error("Obscura MCP process is not writable.");
    }
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  request(method, params, options = {}) {
    if (!this.child?.stdin?.writable) {
      return Promise.reject(new Error("Obscura MCP process is not running."));
    }

    const id = this.nextId++;
    const timeout = options.timeout || this.defaultTimeout;
    return new Promise((resolve, reject) => {
      let timer;
      const onAbort = () => {
        this.stop(new Error("Browser command cancelled."));
      };
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
      };
      const pending = {
        resolve,
        reject,
        finish: (callback) => {
          cleanup();
          callback();
        },
      };
      this.pending.set(id, pending);

      if (options.signal) {
        if (options.signal.aborted) {
          this.pending.delete(id);
          cleanup();
          reject(new Error("Browser command cancelled."));
          return;
        }
        options.signal.addEventListener("abort", onAbort, { once: true });
      }

      timer = setTimeout(() => {
        this.stop(new Error(`Obscura browser command timed out after ${timeout}ms.`));
      }, timeout);

      try {
        this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      } catch (error) {
        this.stop(error);
      }
    });
  }

  stop(error) {
    const child = this.child;
    this.child = null;
    this.readyPromise = null;
    this.buffer = "";

    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      pending.finish(() => pending.reject(error));
    }

    if (child) {
      try {
        child.stdin?.destroy();
        child.kill();
      } catch {
        // The process may have already exited.
      }
    }
  }

  decorateError(error) {
    if (error?.code === "ENOENT") {
      return new Error(
        `Obscura executable not found. Install Obscura and ensure it is on PATH, or set PI_OBSCURA_PATH. ` +
        `On Windows, use the extracted obscura.exe path.`,
      );
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
