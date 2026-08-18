import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, posix as posixPath, win32 as win32Path } from "node:path";
import {
  ObscuraMcpClient,
  commandToMcpCall,
} from "./obscura-mcp-client.js";
import { PinchtabClient, DEFAULT_PINCHTAB_SERVER } from "./pinchtab-client.js";

export const DEFAULT_BROWSER_CONFIG = Object.freeze({
  backend: "auto",
  obscura: Object.freeze({
    path: "",
    stealth: false,
    proxy: "",
    userAgent: "",
    allowPrivateNetwork: false,
  }),
  pinchtab: Object.freeze({
    path: "",
    server: DEFAULT_PINCHTAB_SERVER,
  }),
});

const VALID_BACKENDS = new Set(["auto", "obscura", "pinchtab"]);

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function nonEmptyString(value, name) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${name} must be a string.`);
  return value;
}

function booleanValue(value, name) {
  if (typeof value !== "boolean") throw new Error(`${name} must be a boolean.`);
  return value;
}

function parseEnvBoolean(value, name) {
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off", ""].includes(normalized)) return false;
  throw new Error(`${name} must be true/false, 1/0, yes/no, or on/off.`);
}

function objectValue(value, name) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value;
}

export function browserConfigPath({ env = process.env, platform = process.platform, home = homedir() } = {}) {
  if (env.PI_BROWSER_CONFIG) return env.PI_BROWSER_CONFIG;
  const pathApi = platform === "win32" ? win32Path : posixPath;
  if (platform === "win32") {
    return pathApi.join(env.APPDATA || pathApi.join(home, "AppData", "Roaming"), "pi-agent-browser", "config.json");
  }
  return pathApi.join(env.XDG_CONFIG_HOME || pathApi.join(home, ".config"), "pi-agent-browser", "config.json");
}

function readConfigFile(path) {
  if (!existsSync(path)) return {};
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read browser config ${path}: ${error?.message || String(error)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Browser config ${path} must contain a JSON object.`);
  }
  return parsed;
}

function validateFileConfig(fileConfig, path) {
  const backend = fileConfig.backend;
  if (backend !== undefined && (typeof backend !== "string" || !VALID_BACKENDS.has(backend))) {
    throw new Error(`Browser config ${path} has invalid backend; expected auto, obscura, or pinchtab.`);
  }

  const obscura = objectValue(fileConfig.obscura, `${path}.obscura`);
  for (const key of ["path", "proxy", "userAgent"]) {
    if (obscura[key] !== undefined) nonEmptyString(obscura[key], `${path}.obscura.${key}`);
  }
  for (const key of ["stealth", "allowPrivateNetwork"]) {
    if (obscura[key] !== undefined) booleanValue(obscura[key], `${path}.obscura.${key}`);
  }

  const pinchtab = objectValue(fileConfig.pinchtab, `${path}.pinchtab`);
  for (const key of ["path", "server"]) {
    if (pinchtab[key] !== undefined) nonEmptyString(pinchtab[key], `${path}.pinchtab.${key}`);
  }
}

export function readBrowserConfig(options = {}) {
  const path = options.configPath || browserConfigPath(options);
  const fileConfig = readConfigFile(path);
  validateFileConfig(fileConfig, path);
  return { path, fileConfig };
}

function envOverride(env, key) {
  return hasOwn(env, key) ? env[key] : undefined;
}

export function resolveBrowserConfig(options = {}) {
  const env = options.env || process.env;
  const { path, fileConfig } = readBrowserConfig(options);
  const fileObscura = fileConfig.obscura || {};
  const filePinchtab = fileConfig.pinchtab || {};

  const backend = envOverride(env, "PI_BROWSER_BACKEND") ?? fileConfig.backend ?? DEFAULT_BROWSER_CONFIG.backend;
  if (!VALID_BACKENDS.has(backend)) {
    throw new Error(`PI_BROWSER_BACKEND must be auto, obscura, or pinchtab.`);
  }

  const obscura = {
    ...DEFAULT_BROWSER_CONFIG.obscura,
    ...fileObscura,
  };
  const pinchtab = {
    ...DEFAULT_BROWSER_CONFIG.pinchtab,
    ...filePinchtab,
  };

  const stringEnvFields = [
    ["PI_OBSCURA_PATH", obscura, "path"],
    ["PI_OBSCURA_PROXY", obscura, "proxy"],
    ["PI_OBSCURA_USER_AGENT", obscura, "userAgent"],
    ["PI_PINCHTAB_PATH", pinchtab, "path"],
    ["PI_PINCHTAB_URL", pinchtab, "server"],
  ];
  for (const [envName, target, key] of stringEnvFields) {
    const value = envOverride(env, envName);
    if (value !== undefined) target[key] = nonEmptyString(value, envName);
  }

  const booleanEnvFields = [
    ["PI_OBSCURA_STEALTH", obscura, "stealth"],
    ["PI_OBSCURA_ALLOW_PRIVATE_NETWORK", obscura, "allowPrivateNetwork"],
  ];
  for (const [envName, target, key] of booleanEnvFields) {
    const value = envOverride(env, envName);
    if (value !== undefined) target[key] = parseEnvBoolean(value, envName);
  }

  return {
    path,
    backend,
    obscura,
    pinchtab,
  };
}

function isExecutable(path) {
  try {
    accessSync(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function discoverExecutable(name, { env = process.env, platform = process.platform } = {}) {
  if (!name) return undefined;
  if (name.includes("/") || name.includes("\\")) return isExecutable(name) ? name : undefined;
  const pathValue = env.PATH || "";
  const pathApi = platform === "win32" ? win32Path : posixPath;
  const pathDelimiter = platform === "win32" ? ";" : delimiter === ";" ? ":" : delimiter;
  const extensions = platform === "win32" ? ["", ".exe", ".cmd"] : [""];
  for (const directory of pathValue.split(pathDelimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = pathApi.join(directory, `${name}${extension}`);
      if (isExecutable(candidate)) return candidate;
    }
  }
  return undefined;
}

function obscuraEnvironment(config, env) {
  const result = { ...env };
  if (!hasOwn(env, "PI_OBSCURA_STEALTH")) result.PI_OBSCURA_STEALTH = config.stealth ? "1" : "0";
  if (!hasOwn(env, "PI_OBSCURA_ALLOW_PRIVATE_NETWORK")) {
    result.PI_OBSCURA_ALLOW_PRIVATE_NETWORK = config.allowPrivateNetwork ? "1" : "0";
  }
  if (!hasOwn(env, "PI_OBSCURA_PROXY") && config.proxy) result.PI_OBSCURA_PROXY = config.proxy;
  if (!hasOwn(env, "PI_OBSCURA_USER_AGENT") && config.userAgent) result.PI_OBSCURA_USER_AGENT = config.userAgent;
  if (!hasOwn(env, "PI_OBSCURA_PATH") && config.path) result.PI_OBSCURA_PATH = config.path;
  return result;
}

function startupTimeout(options, fallback) {
  const value = options.startupTimeout || fallback;
  return Math.max(1, Number(value) || fallback);
}

export class BrowserClient {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.config = options.config || resolveBrowserConfig(options);
    this.mode = this.config.backend;
    this.obscura = options.obscuraClient || new ObscuraMcpClient({
      env: obscuraEnvironment(this.config.obscura, this.env),
      executable: this.config.obscura.path || undefined,
      startupTimeout: options.startupTimeout,
    });
    this.pinchtab = options.pinchtabClient || new PinchtabClient({
      server: this.config.pinchtab.server,
      env: this.env,
      defaultTimeout: options.defaultTimeout,
    });
    this.selectedBackend = undefined;
    this.selectionPromise = undefined;
    this.queue = Promise.resolve();
    this.startupTimeout = options.startupTimeout || 10_000;
  }

  async ensureBackend(signal, options = {}) {
    if (this.selectedBackend) return this.selectedBackend;
    if (!this.selectionPromise) {
      this.selectionPromise = this.chooseBackend(signal, options).catch((error) => {
        this.selectionPromise = undefined;
        throw error;
      });
    }
    return this.selectionPromise;
  }

  async chooseBackend(signal, options = {}) {
    const timeout = startupTimeout(options, this.startupTimeout);
    if (this.mode === "pinchtab") {
      await this.probePinchtab(signal, timeout);
      this.selectedBackend = "pinchtab";
      return this.selectedBackend;
    }
    if (this.mode === "obscura") {
      await this.probeObscura(signal, timeout);
      this.selectedBackend = "obscura";
      return this.selectedBackend;
    }

    let pinchtabError;
    try {
      await this.probePinchtab(signal, timeout);
      this.selectedBackend = "pinchtab";
      return this.selectedBackend;
    } catch (error) {
      pinchtabError = error;
    }

    let obscuraError;
    try {
      await this.probeObscura(signal, timeout);
      this.selectedBackend = "obscura";
      return this.selectedBackend;
    } catch (error) {
      obscuraError = error;
    }

    throw new Error(
      `No browser backend is ready. PinchTab: ${pinchtabError?.message || pinchtabError}; ` +
      `Obscura: ${obscuraError?.message || obscuraError}. ` +
      `Start PinchTab at ${this.config.pinchtab.server} or install Obscura.`,
    );
  }

  async probePinchtab(signal, timeout) {
    if (typeof this.pinchtab.health !== "function") return;
    await this.pinchtab.health({ signal, timeout });
  }

  async probeObscura(signal, timeout) {
    if (typeof this.obscura.ensureReady === "function") {
      await this.obscura.ensureReady(signal, timeout);
      return;
    }
    if (typeof this.obscura.ready === "function") {
      await this.obscura.ready({ signal, timeout });
      return;
    }
    throw new Error("Obscura backend does not provide a readiness check.");
  }

  async execute(command, options = {}) {
    const run = async () => {
      if (!command || !command.trim()) throw new Error("A browser command is required.");
      const backend = await this.ensureBackend(options.signal, options);
      if (backend === "pinchtab") {
        const result = await this.pinchtab.callCommand(command, options);
        return { ...result, backend };
      }

      const call = commandToMcpCall(command);
      const result = await this.obscura.callTool(call.tool, call.arguments, {
        ...options,
        startupTimeout: startupTimeout(options, this.startupTimeout),
      });
      return { action: call.action, tool: call.tool, result, backend };
    };

    const next = this.queue.catch(() => undefined).then(run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  async close() {
    await Promise.allSettled([
      typeof this.obscura.close === "function" ? this.obscura.close() : undefined,
      typeof this.pinchtab.close === "function" ? this.pinchtab.close() : undefined,
    ]);
    await this.queue.catch(() => undefined);
  }
}
