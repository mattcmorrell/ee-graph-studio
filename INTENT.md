# INTENT: EE Graph Studio

## Goal

Build the combined vision: Conversation + Canvas scenario planning. The user has a conversation with the AI while the AI draws visual cards on a spatial canvas. Decisions accumulate in a shopping cart. The core interaction is what-if branching — exploring futures, comparing options, choosing and executing.

This combines findings from all three experiments:
- Progressive disclosure interaction model (Exp 1)
- Atomic design patterns for visual consistency (Exp 2/3 hybrid)
- Generative visuals from graph data (Exp 3)

## Current Direction

**Mode-based architecture with dev mode switcher.** Three interaction modes, each with its own canvas rendering and AI prompt:

1. **Analysis** (default): Canvas tree with cards + prompt chips. Progressive disclosure. Knowledge prompts right, action prompts below. Original behavior, now extracted to `modes/analysis.js`.
2. **Branching**: Comparison columns for decision forks. Parent card + 2-3 option columns with effects, people dots, per-column drill prompts, decide buttons, ghost write-in. From decision-branching-v2 mockup.
3. **Allocation**: Scenario planning with group buckets + person chips. Unified AI analysis panel (metrics + insights). Duplicate/decide actions. From resource-allocation-v2 mockup.

Shared core (`app.js`) handles conversation, decision log, API, and mode switching. Each mode registers via `window.Studio.registerMode()` and owns its canvas rendering + response handling.

## What's Done

- Project scaffolded: server with graph tools + LLM pipeline from generative-visuals, canvas engine from jit-ui-canvas
- Full canvas prompting system ported:
  - Knowledge prompts appear RIGHT of cards (dashed blue border)
  - Action prompts appear BELOW cards (dashed green border)
  - Click a prompt → loading pulse on chip → siblings dim → API call → response card replaces prompt node → new prompts appear
  - Focus management: only focused card's child prompts are active, everything else dims
  - Tree-based layout algorithm (right-first, then below)
- System prompt rewritten for single-card progressive disclosure with prompts array
- Conversation pane shows the thread alongside the canvas
- Starter prompts for common scenarios
- gpt-5.4 model, 15 tool call limit
- **Option cards**: AI presents clickable alternatives at decision forks (e.g. replacement candidates). Click one → selected, siblings dim → consequence card + decision logged.
- **Decision log working end-to-end**: Option selection auto-populates the shopping cart with category, title, description. Decision log auto-opens, shows grouped items, has remove button and "Execute Decisions" trigger.
- **Typed block renderers (primitives.js)**: AI outputs structured blocks instead of raw HTML. 6 renderers: person_card (avatar+stats), metric_row, impact_card (severity-colored), cascade_path (animated relationship chain), action_list (prioritized), narrative (markdown). Consistent visual quality across all cards.
- **Human-readable status messages**: Tool calls show contextual messages ("Analyzing impact radius...", "Searching for Raj Patel...") instead of raw function names.
- **Mode system + dev switcher**: Refactored app.js into thin orchestrator + pluggable mode modules. Mode switcher buttons in topbar. Three modes implemented:
  - `modes/analysis.js` — extracted from original app.js, works identically
  - `modes/branching.js` — comparison columns from decision-branching-v2 mockup CSS
  - `modes/allocation.js` — scenario tabs + group buckets + AI analysis panel from resource-allocation-v2 mockup CSS
- **Server prompt split**: `SYSTEM_PROMPT_BASE` (identity, design constraints, atomic patterns) + `MODE_PROMPTS[mode]` (response format, interaction model). `/api/chat` reads `mode` param from request body.
- **Tool call limit raised to 25** (from 15) to support allocation mode's multi-team queries.

## What Works

- End-to-end flow: type question → AI queries graph → card appears on canvas → prompt chips appear → click prompt → new card + new prompts → tree grows
- Loading states: pulsing chip, dimmed siblings, disabled input
- Zoom-to-fit shows the full canvas tree
- Click card to refocus and reactivate its prompts
- Conversation tracks alongside the canvas exploration
- Full decision flow: explore → option cards → select → consequences + decision logged → continue exploring ripple effects
- Visual generation: GPT-5.4 generates HTML from atomic patterns (GV approach). AI owns all color decisions; patterns lock down structure/sizing only.

## Key Insight

**Human-edit → AI re-analysis is the killer feature.** The allocation mode's flow — AI suggests a scenario, user drags people between groups, analysis goes stale, user clicks "Analyze changes", AI provides fresh assessment of the edited state — is the standout interaction pattern. It's not just AI-generates-everything; it's AI-suggests → human-tweaks → AI-reacts. The stale indicator + batch analyze pattern (don't auto-analyze every edit, let the user trigger when ready) should be the template for future interaction modes.

## What Needs Work

- **Branching columns are too narrow for inline drill content.** Clicking a column prompt renders a full AI card inside a ~200px column — it overflows and looks broken. The current hardcoded column widths aren't working. Two paths to explore:
  1. **Widen the whole "Choose a path" block significantly** — give columns enough room for inline expansions. Test whether wider columns solve the readability problem or whether we need a fundamentally different approach.
  2. **Try a totally different pattern** — maybe columns aren't the right container for drillable content. Accordion rows (like branches-v2 in the mockup) might handle variable-height content better.
  - **No hardcoded card widths.** The AI should generate cards that flow naturally. The current `width: 560px` on canvas-card and `max-width: 560px` on canvas-node are too rigid. Need a more elegant approach where AI-generated HTML determines its own size.
- **Allocation interactivity**: Compare view (picker + side-by-side), custom scenario via "+" tab still need work.
- **Layout overlap**: Deep analysis trees can cause cards to overlap.
- **Branching ghost write-in**: Needs testing.

## Rejected Approaches

- **Typed block renderers (primitives.js)**: Built client-side renderers for 6 block types (person_card, metric_row, impact_card, cascade_path, action_list, narrative). The AI output typed JSON, client rendered it. Rejected because it was too limiting — GPT-5.4 composes better visuals when generating HTML freely from atomic patterns than when constrained to pre-defined block types. The GV approach (atomic patterns as prompt guidance + raw HTML output) produces richer, more varied layouts.
- **Colored left borders on severity blocks**: Looks like a sidebar nav, not a data card. Banned.
- **Colored background gradients on blocks**: Makes cards look heavy and garish. Color only in small elements (badge pills, tag chips).

## Open Questions

- How should the AI decide card placement when the user types freely vs clicks a prompt? Free-text input doesn't have a natural parent card.
- Should the AI be allowed to update/modify existing cards, or only add new ones?
- How do we handle scenarios that go 5+ levels deep? Does the canvas get unwieldy?
- When should we split to multi-LLM (orchestrator + renderer)?

## Next Steps

1. **Phase 4: Allocation interactivity** — drag-and-drop between group buckets, undo strip, stale analysis detection, compare view, duplicate/custom scenarios
2. Polish branching mode — inline drill within columns, ghost write-in column flow
3. Layout refinement for deep/wide analysis trees
4. Test all three modes with multiple scenario types
