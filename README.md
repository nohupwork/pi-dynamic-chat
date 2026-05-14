# Dynamic Chat Extension for Pi

Pre-built "chat" modes that disable bash, keep file tools, replace the system
prompt, and inject per-mode sampling parameters into every provider request —
no model reload needed.

All prompts and params live in a sidecar JSON file so they can be tuned without
editing code.

## Install

Copy into a subdirectory under your Pi extensions folder so the JSON sidecar
stays next to the code:

```bash
mkdir -p ~/.pi/agent/extensions/pi-dynamic-chat
cp index.ts config.json ~/.pi/agent/extensions/pi-dynamic-chat/
```

Then restart Pi or run `/reload`.

## Usage

```
/dynamic-chat         Show mode selector
/dynamic-chat off     Disable chat mode, restore all tools
/dynamic-chat <name>  Switch to a named mode
/dynamic-chat "..."   Enable "custom" mode with your own instruction
```

### Modes

| Mode | Temperature | Top_P | Description |
|------|-------------|-------|-------------|
| `creative` | 1.1 | 0.95 | Creative, imaginative prose |
| `focused` | 0.3 | 0.90 | Deterministic analysis and review |
| `balanced` | 0.7 | 0.95 | Research and general knowledge |
| `precise` | 0.6 | 0.95 | Structured planning and roadmaps |
| `custom` | 0.7 | 0.90 | Your own instruction |

## Tuning

Edit `config.json` to customize modes.

```json
{
  "tool_constraints": "\n\nYou have access to file tools...",
  "modes": {
    "creative": {
      "prompt": "You are a creative writing assistant...",
      "params": {
        "temperature": 1.1,
        "top_p": 0.95,
        "top_k": 20,
        "min_p": 0.0,
        "presence_penalty": 0.1,
        "frequency_penalty": 0.05,
        "repetition_penalty": 1.0
      }
    }
  }
}
```

- **Prompt changes** apply on next mode switch (cached at enable time)
- **Param changes** apply immediately on next message (read fresh each request)
- The `tool_constraints` block is appended to every mode prompt automatically
- The `custom` mode has no default prompt — it uses whatever instruction you provide

### Adding New Modes

Add a new entry under `modes`:

```json
"my-mode": {
  "prompt": "You are a ...",
  "params": {
    "temperature": 0.5,
    "top_p": 0.95,
    "top_k": 20,
    "min_p": 0.0,
    "presence_penalty": 0.0,
    "frequency_penalty": 0.0,
    "repetition_penalty": 1.0
  }
}
```

### Supported Parameters

**Standard (all OpenAI-compatible backends):**
- `temperature` — randomness (0.0 = deterministic, 1.0+ = creative)
- `top_p` — nucleus sampling cutoff (0.0–1.0)
- `top_k` — keep only top K tokens per step (0 = disabled)
- `min_p` — minimum token probability ratio (0.0–1.0)
- `presence_penalty` — penalize tokens that already appear (-2.0 to 2.0)
- `frequency_penalty` — penalize tokens proportional to frequency (-2.0 to 2.0)
- `repetition_penalty` — curvature penalty on repeated tokens (1.0 = disabled)

**llama.cpp-specific (passed through, may not work on all backends):**
- `repeat_last_n` — window for repetition penalty (0 = disabled, -1 = full context)
- `dry_multiplier`, `dry_base`, `dry_allowed_length`, `dry_penalty_last_n` — DRY sampling
- `xtc_probability`, `xtc_threshold` — XTC sampling
- `typ_p` — typical sampling
- `tfs_z` — tail-free sampling

Any extra fields in the JSON are passed through to the provider payload.
Backends that don't recognize them will silently ignore them.

## How It Works

Sampling parameters are injected via the `before_provider_request` extension
event. This fires after Pi builds the provider-specific payload but before the
HTTP request is sent. The handler adds/overrides fields in the payload object,
which are then serialized and sent to the backend.

This means:
- **Per-request application** — params change instantly, no model reload
- **Backend-agnostic** — works with any OpenAI-compatible backend (llama.cpp, Ollama, LM Studio, etc.)
- **Graceful degradation** — unknown params are silently ignored by backends that don't support them

## References

- [Qwen 3.6 27B sampling recommendations](https://qwenlm.github.io/)
- [llama.cpp API documentation](https://github.com/ggml-org/llama.cpp)
- [Pi extensions docs](https://github.com/nicepkg/pi-coding-agent/blob/main/docs/extensions.md)
