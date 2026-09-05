import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, posix, win32 } from "node:path";

const APP_DIRECTORY = "pi-agent-browser";
const CONFIG_FILE = "config.json";
const PROFILE_DIRECTORY = "profiles";
const DEFAULT_PROFILE_NAME = "default";
const PROFILE_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_PROFILE_NAME_LENGTH = 64;

function normalizeOptions(options = {}) {
  return {
    env: options.env ?? process.env,
    platform: options.platform ?? process.platform,
  };
}

function pathApi(platform) {
  return platform === "win32" ? win32 : posix;
}

function requiredEnv(env, name) {
  const value = env[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`The ${name} environment variable is required for browser persistence.`);
  }
  return value;
}

export function getPersistencePaths(options = {}) {
  const { env, platform } = normalizeOptions(options);
  const api = pathApi(platform);

  if (platform === "win32") {
    const root = api.join(requiredEnv(env, "LOCALAPPDATA"), APP_DIRECTORY);
    return {
      configPath: api.join(root, CONFIG_FILE),
      profileRoot: api.join(root, PROFILE_DIRECTORY),
    };
  }

  const home = requiredEnv(env, "HOME");
  const configRoot = env.XDG_CONFIG_HOME || api.join(home, ".config");
  const dataRoot = env.XDG_DATA_HOME || api.join(home, ".local", "share");
  return {
    configPath: api.join(configRoot, APP_DIRECTORY, CONFIG_FILE),
    profileRoot: api.join(dataRoot, APP_DIRECTORY, PROFILE_DIRECTORY),
  };
}

export function validateProfileName(name) {
  if (
    typeof name !== "string" ||
    name.length === 0 ||
    name.length > MAX_PROFILE_NAME_LENGTH ||
    !PROFILE_NAME_PATTERN.test(name)
  ) {
    throw new Error(
      "Profile name must be 1-64 characters using lowercase letters, numbers, and single hyphens.",
    );
  }
  return name;
}

function getNativeProfile(env) {
  const value = typeof env.AGENT_BROWSER_PROFILE === "string"
    ? env.AGENT_BROWSER_PROFILE.trim()
    : "";
  return value || undefined;
}

function readConfigFile(configPath) {
  if (!existsSync(configPath)) {
    return { profile: undefined };
  }

  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      Object.keys(parsed).some((key) => key !== "profile")
    ) {
      throw new Error("invalid shape");
    }
    if (parsed.profile === undefined) {
      return { profile: undefined };
    }
    return { profile: validateProfileName(parsed.profile) };
  } catch {
    throw new Error("Invalid pi-agent-browser persistence config.");
  }
}

export function readPersistenceConfig(options = {}) {
  const { configPath } = getPersistencePaths(options);
  return readConfigFile(configPath);
}

function profilePath(name, options) {
  const { platform } = normalizeOptions(options);
  const { profileRoot } = getPersistencePaths(options);
  return pathApi(platform).join(profileRoot, validateProfileName(name));
}

function writeConfig(options, config) {
  const { platform } = normalizeOptions(options);
  const { configPath } = getPersistencePaths(options);
  const api = pathApi(platform);
  mkdirSync(api.dirname(configPath), { recursive: true, mode: 0o700 });
  writeFileSync(configPath, `${JSON.stringify(config)}\n`, { encoding: "utf8", mode: 0o600 });
  if (platform !== "win32") {
    chmodSync(configPath, 0o600);
  }
}

export function enablePersistence(name, options = {}) {
  const normalized = normalizeOptions(options);
  const validName = validateProfileName(name);
  const profile = profilePath(validName, normalized);
  mkdirSync(profile, { recursive: true, mode: 0o700 });
  writeConfig(normalized, { profile: validName });
  return {
    profileName: validName,
    profilePath: profile,
  };
}

export function disablePersistence(options = {}) {
  const normalized = normalizeOptions(options);
  writeConfig(normalized, {});
  return getPersistenceStatus(normalized);
}

export function resolveBrowserProfile(options = {}) {
  const normalized = normalizeOptions(options);
  const nativeProfile = getNativeProfile(normalized.env);
  if (nativeProfile) {
    return {
      source: "environment",
      profilePath: nativeProfile,
    };
  }

  const { profile } = readPersistenceConfig(normalized);
  if (profile) {
    return {
      source: "config",
      profileName: profile,
      profilePath: profilePath(profile, normalized),
    };
  }

  // A missing config means the default profile is enabled; an existing empty
  // config is the explicit `persist off` state.
  const { configPath } = getPersistencePaths(normalized);
  if (!existsSync(configPath)) {
    return {
      source: "config",
      profileName: DEFAULT_PROFILE_NAME,
      profilePath: profilePath(DEFAULT_PROFILE_NAME, normalized),
    };
  }

  return { source: "none" };
}

export function getPersistenceStatus(options = {}) {
  const resolved = resolveBrowserProfile(options);
  if (resolved.source === "config") {
    return {
      enabled: true,
      source: "config",
      profileName: resolved.profileName,
    };
  }
  return {
    enabled: resolved.source !== "none",
    source: resolved.source,
  };
}
