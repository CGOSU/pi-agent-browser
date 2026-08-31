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
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import {
  agentBrowserInstallHint,
  resolveAgentBrowser,
  translateAgentBrowserCommand,
} from "./agent-browser-cli.js";

const TOOL_DESCRIPTION = `Browser automation via agent-browser CLI.
Workflow: open URL → snapshot -i (get @refs like @e1) → interact → re-snapshot after page changes.
Viewing policy:
  Use snapshot -i and get text first.
  Use screenshot only when visual layout, styling, or images are needed.
  Do not take screenshots for text-only questions.
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
  qr [--full] - Capture the current page for QR/manual login and return it inline
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

async function execAgentBrowser(pi: ExtensionAPI, args: string[], options?: any) {
  const executable = resolveAgentBrowser({ env: process.env, platform: process.platform });
  if (!executable) {
    throw new Error(agentBrowserInstallHint(process.platform));
  }
  return pi.exec(executable.command, [...executable.args, ...args], options);
}

function writeTempFile(content: string, prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `pi-browser-${prefix}-`));
  const file = join(dir, "output.txt");
  writeFileSync(file, content);
  return file;
}

export default function agentBrowserExtension(pi: ExtensionAPI) {
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

    renderResult(result: any, { expanded, isPartial }: { expanded: boolean; isPartial: boolean }, theme: any) {
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
        const text = action === "qr"
          ? "QR code returned inline; scan the image below"
          : `Screenshot saved: ${details.screenshotPath || "unknown"}`;
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

      const result = await execAgentBrowser(pi, translateAgentBrowserCommand(parts), {
        signal,
        timeout: 60000,
      });

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
                    ? "QR code returned inline. Scan the image."
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
      await execAgentBrowser(pi, ["close"], { timeout: 5000 });
    } catch {
      // Ignore — browser may already be closed
    }
  });
}
