import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  truncateHead,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
} from "@mariozechner/pi-coding-agent";
import { getCapabilities, Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import {
  agentBrowserInstallHint,
  resolveAgentBrowser,
  translateAgentBrowserCommand,
} from "./agent-browser-cli.js";
import {
  disablePersistence,
  enablePersistence,
  getPersistenceStatus,
  resolveBrowserProfile,
} from "./persistence.js";

const TOOL_DESCRIPTION = `Browser automation via agent-browser CLI.
Workflow: open URL → snapshot -i (get @refs like @e1) → interact → re-snapshot after page changes.
Viewing policy:
  Use snapshot -i and get text first.
  Use screenshot only when visual layout, styling, or images are needed.
  Do not take screenshots for text-only questions.
  For QR login, return only the QR code region with a small white border, never a full-page or viewport image.
  Locate the QR code first and use a supported element screenshot or crop before returning the image.
  If the QR code cannot be located or captured separately, report that limitation; do not fall back to a page screenshot.
  The qr command is an uncropped screenshot alias, not a QR detector or cropper; do not use it for QR login until a supported crop can be applied before returning the image.
Commands:
  open <url> - Navigate to URL
  snapshot -i - Interactive elements with @refs (re-snapshot after navigation)
  click <@ref> - Click element
  fill <@ref> <text> - Clear and type
  type <@ref> <text> - Type without clearing
  select <@ref> <value> - Select dropdown
  press <key> - Press key (Enter, Tab, etc.)
  scroll <dir> [px] - Scroll (up/down/left/right)
  get text|url|title [@ref] - Get information
  wait <@ref|ms> - Wait for element or time
  screenshot [--full] - Take screenshot (image returned inline)
  qr [--full] - Raw screenshot alias; does not isolate QR codes and must not be used for QR login until cropping is supported
  close - Close browser
Any valid agent-browser command works.`;

function parseCommand(command: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let hasValue = false;

  for (let i = 0; i < command.length; i++) {
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

async function execAgentBrowser(
  pi: ExtensionAPI,
  args: string[],
  options?: any,
  profilePath?: string,
) {
  const executable = resolveAgentBrowser({ env: process.env, platform: process.platform });
  if (!executable) {
    throw new Error(agentBrowserInstallHint(process.platform));
  }
  const profileArgs = profilePath ? ["--profile", profilePath] : [];
  return pi.exec(executable.command, [...executable.args, ...profileArgs, ...args], options);
}

function writeTempFile(content: string, prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `pi-browser-${prefix}-`));
  const file = join(dir, "output.txt");
  writeFileSync(file, content);
  return file;
}

function persistenceErrorText(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : "";
  if (
    message.startsWith("Profile name must") ||
    message.startsWith("The ") ||
    message.startsWith("Invalid pi-agent-browser persistence config.")
  ) {
    return message;
  }
  return fallback;
}

function persistenceUsageResult(text: string, isError = true) {
  return {
    content: [{ type: "text", text }],
    details: { action: "persist", ...(isError ? { error: text } : {}) },
    ...(isError ? { isError: true } : {}),
  };
}

function persistenceStatusText(status: ReturnType<typeof getPersistenceStatus>): string {
  if (status.source === "environment") {
    return "Native AGENT_BROWSER_PROFILE is active.";
  }
  if (status.source === "config") {
    return `Persistent profile \"${status.profileName}\" is enabled.`;
  }
  return "Persistent browser profiles are disabled.";
}

function hasProfileOption(parts: string[]): boolean {
  return parts.some((part) => part === "--profile" || part.startsWith("--profile="));
}

export default function agentBrowserExtension(pi: ExtensionAPI) {
  let browserSessionStarted = false;
  let activeBrowserProfile: ReturnType<typeof resolveBrowserProfile> | undefined;

  function getActiveBrowserProfile(): ReturnType<typeof resolveBrowserProfile> {
    if (!browserSessionStarted) {
      activeBrowserProfile = resolveBrowserProfile();
      browserSessionStarted = true;
    }
    return activeBrowserProfile!;
  }

  function resetBrowserSession() {
    browserSessionStarted = false;
    activeBrowserProfile = undefined;
  }

  function handlePersistenceCommand(parts: string[]) {
    const subcommand = parts[1]?.toLowerCase();
    const usage = "Usage: browser persist on <name> | off | status";

    try {
      if (subcommand === "on" && parts.length === 3) {
        const { profileName } = enablePersistence(parts[2]);
        const status = getPersistenceStatus();
        if (status.source === "environment") {
          return persistenceUsageResult(
            `Named profile \"${profileName}\" saved, but native AGENT_BROWSER_PROFILE remains active.`,
            false,
          );
        }
        const suffix = browserSessionStarted
          ? " It will apply after the current browser is closed."
          : "";
        return persistenceUsageResult(`Persistent profile \"${profileName}\" enabled.${suffix}`, false);
      }

      if (subcommand === "off" && parts.length === 2) {
        const status = disablePersistence();
        if (status.source === "environment") {
          return persistenceUsageResult(
            "Named profile persistence disabled, but native AGENT_BROWSER_PROFILE remains active.",
            false,
          );
        }
        const suffix = browserSessionStarted
          ? " The current browser remains unchanged until it is closed."
          : "";
        return persistenceUsageResult(`Persistent browser profiles are disabled.${suffix}`, false);
      }

      if (subcommand === "status" && parts.length === 2) {
        const status = getPersistenceStatus();
        const suffix = browserSessionStarted
          ? " Changes apply after the current browser is closed."
          : "";
        return persistenceUsageResult(persistenceStatusText(status) + suffix, false);
      }

      return persistenceUsageResult(usage);
    } catch (error) {
      return persistenceUsageResult(
        persistenceErrorText(error, "Unable to update browser persistence settings."),
      );
    }
  }

  pi.registerTool({
    name: "browser",
    label: "Browser",
    description: TOOL_DESCRIPTION,
    parameters: Type.Object({
      command: Type.String({ description: "agent-browser command (without 'agent-browser' prefix)" }),
    }),

    renderCall(args: { command: string }, theme: any) {
      const text = theme.fg("toolTitle", theme.bold("browser ")) + theme.fg("accent", args.command);
      return new Text(text, 0, 0);
    },

    renderResult(
      result: any,
      { expanded, isPartial }: { expanded: boolean; isPartial: boolean },
      theme: any,
      context: any,
    ) {
      if (isPartial) {
        return new Text(theme.fg("warning", "Running..."), 0, 0);
      }

      const details = result.details || {};

      // Error
      if (result.isError || details.error) {
        const errorText = details.error || result.content?.[0]?.text || "Error";
        return new Text(theme.fg("error", errorText), 0, 0);
      }

      const action = details.action || "";
      const content = result.content?.[0]?.text || "";

      // Screenshot
      if (action === "screenshot" || action === "qr") {
        const screenshotPath = details.screenshotPath || "unknown";
        let text;
        if (action === "qr") {
          const supportsInlineImages = Boolean(getCapabilities().images);
          if (context?.showImages === false) {
            text = `QR code saved: ${screenshotPath}\nInline image display is disabled in Pi settings; open the saved PNG file.`;
          } else {
            text = supportsInlineImages
              ? `QR code returned inline; scan the image below\nSaved: ${screenshotPath}`
              : `QR code saved: ${screenshotPath}\nThis terminal cannot display inline images; open the saved PNG file.`;
          }
        } else {
          text = `Screenshot saved: ${screenshotPath}`;
        }
        return new Text(theme.fg("success", text), 0, 0);
      }

      // Snapshot — show element count
      if (action === "snapshot") {
        const refCount = (content.match(/@e\d+/g) || []).length;
        let text = theme.fg("success", `${refCount} interactive elements`);
        if (details.truncated) {
          text += theme.fg("warning", " (truncated)");
        }
        if (expanded) {
          text += "\n" + theme.fg("dim", content);
        }
        return new Text(text, 0, 0);
      }

      // Default — compact output
      if (expanded) {
        return new Text(theme.fg("dim", content), 0, 0);
      }

      // Compact: first line only
      const firstLine = content.split("\n")[0] || "(no output)";
      const truncated = content.includes("\n") ? "…" : "";
      return new Text(theme.fg("dim", firstLine + truncated), 0, 0);
    },

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const commandStr = params.command.trim();
      const parts = parseCommand(commandStr);
      if (parts.length === 0) {
        return {
          content: [{ type: "text", text: "A browser command is required." }],
          details: { error: "empty-command" },
          isError: true,
        };
      }

      const action = parts[0].toLowerCase();

      if (action === "persist") {
        return handlePersistenceCommand(parts);
      }

      if (!resolveAgentBrowser({ env: process.env, platform: process.platform })) {
        const message = `agent-browser CLI was not found in PATH (not installed or not on PATH). Browser commands are unavailable.\n${agentBrowserInstallHint(process.platform)}\nIf already installed, add it to PATH and restart Pi.`;
        if (ctx?.hasUI) {
          ctx.ui.notify(message, "error");
        }
        return {
          content: [{ type: "text", text: message }],
          details: { error: message, code: "agent-browser-not-found", action },
          isError: true,
        };
      }

      let activeProfile: ReturnType<typeof resolveBrowserProfile>;
      try {
        activeProfile = getActiveBrowserProfile();
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: persistenceErrorText(error, "Unable to load browser persistence settings."),
          }],
          details: { error: "persistence-config", action },
          isError: true,
        };
      }

      if (activeProfile.profilePath && hasProfileOption(parts)) {
        return {
          content: [{
            type: "text",
            text: "Do not pass --profile while browser persistence is active; use `browser persist on <name>` instead.",
          }],
          details: { error: "profile-override", action },
          isError: true,
        };
      }

      let result;
      try {
        result = await execAgentBrowser(
          pi,
          translateAgentBrowserCommand(parts),
          { signal, timeout: 60000 },
          activeProfile.profilePath,
        );
      } finally {
        if (action === "close") {
          resetBrowserSession();
        }
      }

      if (result.code !== 0) {
        const errorOutput = (result.stderr || result.stdout).trim();
        return {
          content: [{ type: "text", text: errorOutput || `Command failed with exit code ${result.code}` }],
          details: { error: errorOutput, exitCode: result.code, command: commandStr },
          isError: true,
        };
      }

      const output = result.stdout.trim();

      // Screenshot: extract path, read file, return as image
      if (action === "screenshot" || action === "qr") {
        const pathMatch = output.match(/saved(?:\s+to|:)\s+(.+)$/i);
        if (pathMatch) {
          const screenshotPath = pathMatch[1].trim();
          try {
            const imageData = readFileSync(screenshotPath);
            const base64 = imageData.toString("base64");
            const ext = extname(screenshotPath).toLowerCase();
            const mimeType = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg"
              : ext === ".webp" ? "image/webp"
              : "image/png";
            return {
              content: [
                {
                  type: "text",
                  text: action === "qr"
                    ? `QR code returned inline. Scan the image.\nSaved: ${screenshotPath}`
                    : `Screenshot saved: ${screenshotPath}`,
                },
                { type: "image", data: base64, mimeType },
              ],
              details: { command: commandStr, action, screenshotPath },
            };
          } catch (err: any) {
            return {
              content: [{
                type: "text",
                text: action === "qr"
                  ? `QR code saved to ${screenshotPath} but could not return it inline: ${err.message}`
                  : `Screenshot saved to ${screenshotPath} but could not read file: ${err.message}`,
              }],
              details: { command: commandStr, action, screenshotPath, readError: err.message },
            };
          }
        }
      }

      // Apply truncation to large outputs (especially snapshot)
      const truncation = truncateHead(output, {
        maxLines: DEFAULT_MAX_LINES,
        maxBytes: DEFAULT_MAX_BYTES,
      });

      let resultText = truncation.content;

      if (truncation.truncated) {
        const tempFile = writeTempFile(output, action);
        resultText += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines`;
        resultText += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
        resultText += ` Full output saved to: ${tempFile}]`;
      }

      return {
        content: [{ type: "text", text: resultText || "(no output)" }],
        details: { command: commandStr, action, truncated: truncation.truncated },
      };
    },
  });

  // Clean up browser on session exit
  pi.on("session_shutdown", async (_event, _ctx) => {
    try {
      const activeProfile = getActiveBrowserProfile();
      await execAgentBrowser(pi, ["close"], { timeout: 5000 }, activeProfile.profilePath);
    } catch {
      // Ignore — browser may already be closed or persistence config may be unavailable
    } finally {
      resetBrowserSession();
    }
  });
}
