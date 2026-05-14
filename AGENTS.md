# pi-dynamic-chat

Pi extension: per-mode system prompts, tool restrictions, and sampling parameters.

## Sister project

This extension has a sister project, `pi-dynamic-settings`, which shares the same
mode names and parameter values but does not replace prompts or restrict tools.

If the sister project is found at `../pi-dynamic-settings`, keep both in sync:

- When modifying shared code (config loading, param injection, status bar,
  mode enable/disable logic), apply the same changes there.
- Keep mode names and parameter values aligned between both `config.json` files.
- The structural difference: this extension replaces the system prompt and disables
  bash. The settings extension leaves everything alone and only injects params.
