import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  truncateHead,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { BrowserClient } from "./browser-client.js";
import { commandToMcpCall, mcpResultToPiContent } from "./obscura-mcp-client.js";

const TOOL_DESCRIPTION = `Browser automation via the configured Obscura MCP or PinchTab HTTP backend.
Workflow: open URL → snapshot -i (get refs like e1) → interact → re-snapshot after page changes.
Viewing policy:
  Use snapshot -i and get text first.
  Use screenshot only when visual layout, styling, or images are needed.
  Do not take screenshots for text-only questions.
Backend policy:
  The backend is selected automatically or from the user config.
  If browser fails, report the error; do not use Playwright, Chrome, or another browser tool as a fallback.
Commands:
  open <url> - Navigate to a URL
  snapshot [-i] - Read the page or list interactive refs
  click <@ref|selector> - Click element
  fill <@ref|selector> <text> - Clear and fill
  type <@ref|selector> <text> - Append text
  select <@ref|selector> <value> - Select dropdown
  press <key> - Key down/up
  scroll <dir> [px] - Scroll top/bottom/up/down/left/right
  get text|url|title|html|value|attr - Get information
  wait <@ref|selector|ms> - Wait for element or time
  screenshot - Take a viewport screenshot and return it inline
  eval <javascript> - Evaluate JavaScript
  back|forward|reload - Navigate history
  tab [new|list|close|switch] - Manage tabs
  close - Close browser
Obscura or PinchTab is the browser backend; unsupported commands return an explicit error. Browser failures are returned directly and are never replayed through another backend.`;

function writeTempFile(content: string, prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `pi-browser-${prefix}-`));
  const file = join(dir, "output.txt");
  writeFileSync(file, content);
  return file;
}

function waitFor(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Browser command cancelled."));
    };
    function done() {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }
    if (signal?.aborted) {
      onAbort();
    } else {
      signal?.addEventListener("abort", onAbort, { once: true });
    }
  });
}

export default function agentBrowserExtension(pi: ExtensionAPI) {
  const browser = new BrowserClient();
  pi.registerTool({
    name: "browser",
    label: "Browser",
    description: TOOL_DESCRIPTION,
    parameters: Type.Object({
      command: Type.String({ description: "Browser command (for example: open <url>, snapshot -i, click @e1)" }),
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
      const content = (result.content || [])
        .filter((item: any) => item.type === "text")
        .map((item: any) => item.text)
        .join("\n");
      const hasImage = (result.content || []).some((item: any) => item.type === "image");

      // Screenshot
      if (action === "screenshot") {
        return new Text(theme.fg("success", hasImage ? "Screenshot returned inline" : "Screenshot completed"), 0, 0);
      }

      // Snapshot — show element count
      if (action === "snapshot") {
        const refs = (content.match(/\bref=@?e\d+/g) || []).length;
        const registered = content.match(/(\d+) interactive element\(s\) registered/);
        const refCount = refs || (registered ? Number(registered[1]) : 0);
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

    async execute(_toolCallId, params, signal) {
      const commandStr = params.command.trim();
      let call;
      let execution;

      try {
        // Validate the shared command surface before selecting or probing a backend.
        // Fixed waits remain local and do not need a browser connection.
        call = commandToMcpCall(commandStr);
        if (call.localWaitMs !== undefined) {
          await waitFor(call.localWaitMs, signal);
          return {
            content: [{ type: "text", text: `Waited ${call.localWaitMs}ms` }],
            details: { command: commandStr, action: call.action, backend: "local" },
          };
        }

        execution = await browser.execute(commandStr, {
          signal,
          timeout: 60000,
        });
        const result = execution.result;
        const content = mcpResultToPiContent(result);
        const output = content
          .filter((item: any) => item.type === "text")
          .map((item: any) => item.text)
          .join("\n");
        const truncation = truncateHead(output, {
          maxLines: DEFAULT_MAX_LINES,
          maxBytes: DEFAULT_MAX_BYTES,
        });

        let resultText = truncation.content;
        if (truncation.truncated) {
          const tempFile = writeTempFile(output, call.action);
          resultText += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines`;
          resultText += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
          resultText += ` Full output saved to: ${tempFile}]`;
        }

        const finalContent = content.filter((item: any) => item.type !== "text");
        if (output || finalContent.length === 0) {
          finalContent.unshift({ type: "text", text: resultText || "(no output)" });
        }

        return {
          content: finalContent,
          details: {
            command: commandStr,
            action: execution.action,
            tool: execution.tool,
            backend: execution.backend,
            truncated: truncation.truncated,
          },
        };
      } catch (error: any) {
        const message = error?.message || String(error);
        return {
          content: [{ type: "text", text: message }],
          details: { error: message, command: commandStr, action: execution?.action || call?.action, backend: execution?.backend },
          isError: true,
        };
      }
    },
  });

  // Clean up backend resources on session exit; PinchTab itself remains running.
  pi.on("session_shutdown", async () => {
    await browser.close();
  });
}
