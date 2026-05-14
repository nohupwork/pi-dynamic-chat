/**
 * Chat Mode Extension
 *
 * Pre-built "chat" modes that disable bash, keep file tools, replace the system
 * prompt, and inject per-mode sampling parameters (temperature, top_p, etc.) into
 * every provider request — no model reload needed.
 *
 * Sampling params are loaded from a sidecar JSON file (chat-mode.json) so they
 * can be tuned without editing code.
 *
 * Usage:
 *   /chat              Show mode selector
 *   /chat off          Disable chat mode, restore all tools
 *   /chat <name>       Switch to a named mode
 *   /chat "custom..."  Enable "custom" mode with your own instruction
 *
 * When active:
 * - bash tool is disabled
 * - System prompt is replaced with the selected mode's prompt
 * - Sampling params (temperature, top_p, …) are injected into each provider request
 * - Status bar shows "mode:<name>"
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ── Paths ────────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, "chat-mode.json");

// ── Types ────────────────────────────────────────────────────────────────────

interface SamplingParams {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  repetition_penalty?: number;
  [key: string]: number | undefined;
}

interface ConfigFile {
  modes?: Record<string, SamplingParams>;
}

// ── Defaults ─────────────────────────────────────────────────────────────────
// Fallback values when config file is missing or a mode has no entry.
// Based on Qwen 3.6 27B official recommendations + user's llama.cpp defaults.

const DEFAULT_PARAMS: SamplingParams = {
  temperature: 0.7,
  top_p: 0.9,
  top_k: 20,
  min_p: 0.0,
  presence_penalty: 0.0,
  frequency_penalty: 0.0,
  repetition_penalty: 1.0,
};

// ── Config Loading ───────────────────────────────────────────────────────────

function loadConfig(): ConfigFile {
  if (!existsSync(CONFIG_PATH)) {
    return { modes: {} };
  }
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as ConfigFile;
  } catch (err) {
    // Swallow — extension still works with hardcoded defaults
    console.error(`[chat-mode] Failed to parse ${CONFIG_PATH}:`, err);
    return { modes: {} };
  }
}

const config = loadConfig();
const modeParams: Record<string, SamplingParams> = config.modes ?? {};

function getParamsForMode(mode: string): SamplingParams {
  return modeParams[mode] ?? DEFAULT_PARAMS;
}

// ── Mode Prompts ─────────────────────────────────────────────────────────────

// Shared constraints appended to every mode prompt
const TOOL_CONSTRAINTS = `\n\nYou have access to file tools (read, edit, write, grep, find, ls) so you can read, create, and search files.\n\nYou do NOT have access to bash/shell execution. If a task requires running commands, installing packages, or executing code, explain what would need to be done and guide the user instead.`;

const MODE_PROMPTS: Record<string, string> = {
  research: `You are a research and knowledge assistant. Answer questions thoroughly, explain complex topics clearly, compare options with pros and cons, and summarize long texts. When uncertain, say so and explain what would help clarify. Break down answers into structured sections when useful.${TOOL_CONSTRAINTS}`,

  writing: `You are a writing and editing assistant. Help draft, revise, and polish prose. Focus on clarity, tone, structure, and style. Suggest concrete improvements — don't just say something is "good" or "bad". Adapt to the user's preferred voice and format.${TOOL_CONSTRAINTS}`,

  analysis: `You are an analysis and review assistant. Critique code, documents, or arguments. Spot issues, suggest improvements, and break down complex material. Be thorough and skeptical — look for edge cases, assumptions, and weaknesses. Structure your findings clearly.${TOOL_CONSTRAINTS}`,

  planning: `You are a planning and structuring assistant. Help organize thoughts, break down projects, create outlines and roadmaps. Turn vague ideas into concrete steps. Identify dependencies, risks, and milestones. Use lists and structured formats.${TOOL_CONSTRAINTS}`,

  chat: `You are a helpful general-purpose assistant. Answer questions, solve problems, brainstorm ideas, and have natural conversations. Be direct and practical — no unnecessary preamble.${TOOL_CONSTRAINTS}`,
};

const MODE_NAMES = Object.keys(MODE_PROMPTS);

// Tools to keep enabled in chat mode (everything except bash)
const CHAT_TOOLS = ["read", "edit", "write", "grep", "find", "ls"];

// ── Extension ────────────────────────────────────────────────────────────────

export default function chatModeExtension(pi: ExtensionAPI) {
  let activeMode: string | undefined;
  let customInstruction: string | undefined;
  let originalTools: string[] | undefined;

  function updateStatus(ctx: ExtensionContext) {
    if (activeMode) {
      ctx.ui.setStatus("chat-mode", ctx.ui.theme.fg("accent", `mode:${activeMode}`));
    } else {
      ctx.ui.setStatus("chat-mode", undefined);
    }
  }

  async function enableMode(ctx: ExtensionContext, mode: string, instruction?: string): Promise<void> {
    activeMode = mode;
    customInstruction = instruction;

    // Save original tools on first enable
    if (originalTools === undefined) {
      originalTools = pi.getActiveTools();
    }

    // Filter to chat-compatible tools that actually exist
    const allToolNames = pi.getAllTools().map((t) => t.name);
    const availableChatTools = CHAT_TOOLS.filter((t) => allToolNames.includes(t));
    pi.setActiveTools(availableChatTools);

    const params = getParamsForMode(mode);
    const paramSummary = `temp=${params.temperature}, top_p=${params.top_p}`;
    ctx.ui.notify(`Mode "${mode}" enabled — bash disabled, ${paramSummary}`, "info");
    updateStatus(ctx);
  }

  async function disableMode(ctx: ExtensionContext): Promise<void> {
    if (!activeMode) {
      ctx.ui.notify("No chat mode is active", "info");
      return;
    }

    const prev = activeMode;
    activeMode = undefined;
    customInstruction = undefined;

    if (originalTools) {
      pi.setActiveTools(originalTools);
      originalTools = undefined;
    } else {
      pi.setActiveTools(["read", "bash", "edit", "write"]);
    }

    ctx.ui.notify(`Mode "${prev}" disabled — all tools restored`, "info");
    updateStatus(ctx);
  }

  async function showSelector(ctx: ExtensionContext): Promise<void> {
    const items = [
      ...MODE_NAMES.map((name) => {
        const params = getParamsForMode(name);
        return `${name} (temp=${params.temperature}) — ${MODE_PROMPTS[name].slice(0, 60)}...`;
      }),
      "custom — provide your own instruction",
    ];

    const choice = await ctx.ui.select("Select chat mode", items);
    if (!choice) return;

    if (choice.startsWith("custom")) {
      const instruction = await ctx.ui.input("Custom instruction", "You are a ...");
      if (!instruction) return;
      await enableMode(ctx, "custom", instruction);
    } else {
      const name = choice.split(" (")[0];
      await enableMode(ctx, name);
    }
  }

  // ── Commands ─────────────────────────────────────────────────────────────

  pi.registerCommand("chat", {
    description: "Switch chat mode (research, writing, analysis, planning, chat). No args shows selector.",
    getArgumentCompletions: (prefix) => {
      const options = [...MODE_NAMES, "off"];
      const filtered = options.filter((o) => o.startsWith(prefix));
      return filtered.length > 0 ? filtered.map((o) => ({ value: o, label: o })) : null;
    },
    handler: async (args, ctx) => {
      const arg = args?.trim();

      if (!arg) {
        await showSelector(ctx);
      } else if (arg.toLowerCase() === "off") {
        await disableMode(ctx);
      } else if (MODE_NAMES.includes(arg.toLowerCase())) {
        await enableMode(ctx, arg.toLowerCase());
      } else {
        await enableMode(ctx, "custom", arg);
      }
    },
  });

  // ── Events ───────────────────────────────────────────────────────────────

  // Replace system prompt when a mode is active
  pi.on("before_agent_start", async (event) => {
    if (!activeMode) return undefined;

    if (activeMode === "custom" && customInstruction) {
      return { systemPrompt: customInstruction + TOOL_CONSTRAINTS };
    }
    if (MODE_PROMPTS[activeMode]) {
      return { systemPrompt: MODE_PROMPTS[activeMode] };
    }
    return undefined;
  });

  // Inject sampling parameters into every provider request
  pi.on("before_provider_request", (event) => {
    if (!activeMode) return undefined;

    const params = getParamsForMode(activeMode);

    // Only include defined values — let the provider use its defaults for anything omitted
    const overrides: Record<string, number> = {};
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        overrides[key] = value;
      }
    }

    if (Object.keys(overrides).length === 0) {
      return undefined;
    }

    return { ...event.payload, ...overrides };
  });

  // Initialize status on session start
  pi.on("session_start", async (_event, ctx) => {
    updateStatus(ctx);
  });
}
