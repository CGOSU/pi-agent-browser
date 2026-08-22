import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, closeSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const PINCHTAB_VERSION = "v0.15.1";
const LOCK_TIMEOUT_MS = 30_000;
const LOCK_STALE_MS = 5 * 60_000;
const RELEASE_BASE = `https://github.com/pinchtab/pinchtab/releases/download/${PINCHTAB_VERSION}`;
const ASSETS = Object.freeze({
  "win32/x64": ["pinchtab-windows-amd64.exe", "6335dd1f5bc94ffc27930c901a4d5e7f87cc09e1ccacb1d8b03a98facf0cd15e"],
  "win32/arm64": ["pinchtab-windows-arm64.exe", "ba8296be3f5487dd571f69a9b96bbbca10c6f55c6ab83b38ac179d83fdbc82a6"],
  "linux/x64": ["pinchtab-linux-amd64", "3f5ceaaf172e8c8c0276a0c8efa4009cb2484d60422e044a5fb21cf0577f893c"],
  "linux/arm64": ["pinchtab-linux-arm64", "f2b0bfdf76d5e55ccc6a4d7e08bb934feffe930af6cede7a7403d046f2a47730"],
  "darwin/x64": ["pinchtab-darwin-amd64", "29f9a0ebf5ddead810bed5ad42a9a97e540e3a3339a9413a67f6f6911d0be364"],
  "darwin/arm64": ["pinchtab-darwin-arm64", "0d4df1655e1115c1d45b86d2c3c3ef9212b496195219e3415551c57dffb3e4d9"],
});

function assetFor(platform, arch, manifest = ASSETS) {
  const asset = manifest[`${platform}/${arch}`];
  if (!asset) throw new Error(`PinchTab auto-install is unsupported on ${platform}/${arch}.`);
  return asset;
}

function cacheRoot({ env, platform, home }) {
  if (platform === "win32") return env.LOCALAPPDATA || join(home, "AppData", "Local");
  return env.XDG_CACHE_HOME || join(home, ".cache");
}

function validCachedBinary(path, expected) {
  if (!existsSync(path)) return false;
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex") === expected;
  } catch {
    return false;
  }
}

function lockIsStale(path) {
  try {
    return Date.now() - statSync(path).mtimeMs > LOCK_STALE_MS;
  } catch {
    return false;
  }
}

async function acquireLock(path) {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const fd = openSync(path, "wx");
      writeFileSync(fd, `${process.pid}\n`, "utf8");
      return fd;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (lockIsStale(path)) rmSync(path, { force: true });
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("Timed out waiting for another PinchTab download to finish.");
}

export function pinchtabAsset(platform = process.platform, arch = process.arch) {
  return assetFor(platform, arch)[0];
}

export function pinchtabDownloadUrl(platform = process.platform, arch = process.arch) {
  return `${RELEASE_BASE}/${pinchtabAsset(platform, arch)}`;
}

export async function installPinchtab({
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  home = homedir(),
  fetchImpl = globalThis.fetch,
  version = PINCHTAB_VERSION,
  manifest = ASSETS,
  releaseBase = RELEASE_BASE,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("PinchTab auto-install requires fetch.");
  const [asset, expected] = assetFor(platform, arch, manifest);
  const root = join(cacheRoot({ env, platform, home }), "pi-agent-browser", "pinchtab", version);
  const target = join(root, asset);
  if (validCachedBinary(target, expected)) return target;

  mkdirSync(root, { recursive: true });
  const lockPath = join(root, ".download.lock");
  const lockFd = await acquireLock(lockPath);
  try {
    if (validCachedBinary(target, expected)) return target;
    const response = await fetchImpl(`${releaseBase}/${asset}`, { redirect: "follow" });
    if (!response.ok) throw new Error(`PinchTab download failed (${response.status}).`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== expected) throw new Error(`PinchTab checksum mismatch for ${asset}.`);

    const temp = `${target}.${process.pid}.download`;
    try {
      writeFileSync(temp, bytes, { mode: 0o755 });
      if (platform !== "win32") chmodSync(temp, 0o755);
      renameSync(temp, target);
    } catch (error) {
      rmSync(temp, { force: true });
      throw error;
    }
    return target;
  } finally {
    closeSync(lockFd);
    rmSync(lockPath, { force: true });
  }
}
