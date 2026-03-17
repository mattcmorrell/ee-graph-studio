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
- Decision log sidebar (collapsible, categories, execute button) — wired up but AI not yet populating it reliably
- gpt-5.4 model, 15 tool call limit

## What Works

- End-to-end flow: type question → AI queries graph → card appears on canvas → prompt chips appear → click prompt → new card + new prompts → tree grows
- Loading states: pulsing chip, dimmed siblings, disabled input
- Zoom-to-fit shows the full canvas tree
- Click card to refocus and reactivate its prompts
- Conversation tracks alongside the canvas exploration

## What Needs Work

- **Decision log integration**: The AI needs to reliably populate the decisions array when users make choices via action prompts. Currently mostly empty.
- **What-if branching**: The core innovation. Need to support forking — "what if Lisa instead of Derek?" should create a parallel branch. Currently the tree is strictly linear (each prompt leads to one response).
- **Conversation input → canvas**: Currently only prompt chip clicks generate cards. Typing in the conversation input should also produce cards on the canvas.
- **Layout overlap**: Deep trees can cause cards to overlap. The column-tracking algorithm needs refinement for complex branching.
- **Compare mode**: No way to see two branches side by side yet. This is where the canvas earns its place over tabs/tree.

## Rejected Approaches

_None yet for this project. See generative-visuals/INTENT.md for Experiment 3 rejections._

## Open Questions

- How should the AI decide card placement when the user types freely vs clicks a prompt? Free-text input doesn't have a natural parent card.
- Should the AI be allowed to update/modify existing cards, or only add new ones?
- How do we handle scenarios that go 5+ levels deep? Does the canvas get unwieldy?
- When should we split to multi-LLM (orchestrator + renderer)?

## Next Steps

1. Get decision log working — AI populates shopping cart on action choices
2. Wire conversation input to also produce canvas cards
3. What-if branching — parallel paths from decision points
4. Test with multiple scenario types (not just Raj Patel departure)
5. Layout refinement for deep/wide trees
