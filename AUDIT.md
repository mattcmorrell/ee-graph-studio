# EE Graph Studio Audit

Gaps compared to jit-ui-canvas (JIT) and generative-visuals (GV).

## Tier 1 — Makes the Demo Work

- [x] **Decision log integration** — Option cards auto-populate decisions. Done.
- [x] **Option cards** — Built. Click to select, dims siblings, logs decision, triggers consequence card.
- [x] **Forced tool call fallback** — Already in place (line 830 of server.js, `tool_choice: 'none'` on last iteration).
- [ ] ~~**Freetext → canvas reliability**~~ — Decided not to do. Canvas is prompt-chip-driven by design.

## Tier 2 — Visual Quality Parity

- [x] **Status messages during tool calls** — Done. "Analyzing impact radius...", "Searching for Raj Patel..." etc.
- [x] **Avatar URL in system prompt** — Confirmed present in person lockup pattern.
- [x] ~~**Port primitives.js renderers**~~ — Tried and rejected. GPT-5.4 generates better visuals composing freely from atomic patterns than from pre-defined block types.
- [x] ~~**Blocks array vs single HTML string**~~ — Decided to keep card.html. Atomic patterns + AI generation > typed blocks.
- [ ] **Click-to-expand person drill-down** — Click any person lockup → fetch direct reports → expand inline without AI round-trip. Lightweight, instant. *(GV feature)*
- [ ] **Sync visuals with GV** — GV is the target state for visual quality. Compare what GPT-5.4 produces in studio vs GV and close any gaps in the prompt.
- [ ] ~~**Cascade path visualization**~~ — Was a typed block renderer. Now that we're on atomic patterns, the AI can generate relationship chains as HTML if it wants. Not a separate feature to build.
- [ ] ~~**Chart support**~~ — Same — AI can generate CSS bars/charts via the bar/proportion pattern. No client-side charting needed.
- [ ] ~~**FYI blocks**~~ — Covered by the severity block atomic pattern.

## Tier 3 — Unique Value Proposition

- [ ] **What-if branching** — Fork from decision points to explore parallel paths. The core innovation. Currently tree is strictly linear.
- [ ] **Compare mode** — Side-by-side view of two branches. This is what makes canvas > tabs.
- [ ] **Layout refinement for branching** — Column tracking doesn't handle deep/wide trees. Overlaps when 5+ levels deep.
- [ ] **Decision ↔ card linking** — Click a decision in the log to highlight the originating card on canvas. *(GV mockup feature)*
- [ ] **Decision UX redesign** — Need more explicit "I decide this" moments. Current option-click flow is too implicit.

## Tier 4 — Polish & UX

- [ ] **Refocus indicator** — JIT has 2px purple border + 24px glow on selected cards. Studio's selected state is too subtle.
- [ ] **Error recovery UI** — No retry button or fallback if card render fails or API errors mid-exploration.
- [ ] **Keyboard shortcuts** — No Escape to deselect, no Cmd+0 for zoom-to-fit, no arrow navigation.
- [ ] **Missing get_org_stats tool** — JIT has pre-computed rankings/distributions tool. Studio doesn't.
- [ ] **Theme toggle** — Both source projects have dark/light switching with localStorage. Studio is dark-only.
- [ ] **Theme passed to LLM** — GV sends current theme so generated HTML matches. Studio hardcodes dark theme.
