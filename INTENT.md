# INTENT: EE Graph Studio

## Goal

Build the combined vision: Conversation + Canvas scenario planning. The user has a conversation with the AI while the AI draws visual cards on a spatial canvas. Decisions accumulate in a shopping cart. The core interaction is what-if branching — exploring futures, comparing options, choosing and executing.

This combines findings from all three experiments:
- Progressive disclosure interaction model (Exp 1)
- Atomic design patterns for visual consistency (Exp 2/3 hybrid)
- Generative visuals from graph data (Exp 3)

## Current Direction

Canvas-first. Three-pane layout: spatial canvas (left), collapsible decision log (middle), conversation (right). The AI responds with one focused card per turn + prompt chips that appear on the canvas. Knowledge prompts go right (explore/understand), action prompts go below (decide/act). The canvas tree grows organically as the user clicks through prompts.

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

## What Works

- End-to-end flow: type question → AI queries graph → card appears on canvas → prompt chips appear → click prompt → new card + new prompts → tree grows
- Loading states: pulsing chip, dimmed siblings, disabled input
- Zoom-to-fit shows the full canvas tree
- Click card to refocus and reactivate its prompts
- Conversation tracks alongside the canvas exploration
- Full decision flow: explore → option cards → select → consequences + decision logged → continue exploring ripple effects
- Visual generation: GPT-5.4 generates HTML from atomic patterns (GV approach). AI owns all color decisions; patterns lock down structure/sizing only.

## What Needs Work

- **What-if branching**: The core innovation. Need to support forking — "what if Lisa instead of Derek?" should create a parallel branch. Currently the tree is strictly linear (each prompt leads to one response).
- **Layout overlap**: Deep trees can cause cards to overlap. The column-tracking algorithm needs refinement for complex branching.
- **Compare mode**: No way to see two branches side by side yet. This is where the canvas earns its place over tabs/tree.

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

1. Review remaining audit items (AUDIT.md) — what else to pull from source projects
2. Decision UX redesign — current option-click flow is too implicit, need more explicit "I decide this" moments
3. What-if branching — "explore scenarios" prompts that fork the tree into parallel paths
4. Compare mode — side-by-side view of two branches
5. Layout refinement for deep/wide/branching trees
6. Test with multiple scenario types (not just Raj Patel departure)
