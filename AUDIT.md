# EE Graph Studio Audit

Gaps compared to jit-ui-canvas (JIT) and generative-visuals (GV).

## Tier 1 — Makes the Demo Work

- [ ] **Decision log integration** — AI rarely fills the `decisions` array. Need stronger prompting and option cards as triggers. *(vs JIT: option cards auto-populate decisions)*
- [ ] **Option cards** — JIT has clickable scenario choice cards (e.g. "Promote Lisa" vs "Hire externally") with avatar/name/reason. Clicking one selects it, dims siblings, logs decision. Studio has nothing like this.
- [ ] **Freetext → canvas reliability** — Typing in conversation should always produce a canvas card. Currently fragile — AI sometimes returns text-only responses.
- [ ] **Forced tool call fallback** — If 15 tool calls exhausted, force a final response with `tool_choice: 'none'`. Without this the loop can hang. *(JIT does this)*

## Tier 2 — Visual Quality Parity

- [ ] **Port primitives.js renderers** — JIT has 600 lines of client-side block renderers (person_card, impact_card, metric_row, cascade_path, relationship_map, chart, fyi, etc). Studio relies entirely on AI-generated inline HTML with no correction layer.
- [ ] **Cascade path visualization** — Animated relationship chain showing "why we discovered this" — staggered node-by-node reveal of graph traversal. *(JIT feature)*
- [ ] **Chart support** — Bar, donut, and timeline charts rendered client-side. Studio has no charting. *(JIT feature)*
- [ ] **FYI blocks** — Severity-colored info blocks for consequences and warnings after choices. *(JIT feature)*
- [ ] **Click-to-expand person drill-down** — Click any person lockup → fetch direct reports → expand inline without AI round-trip. Lightweight, instant. *(GV feature)*
- [ ] **Status messages during tool calls** — Show "Analyzing impact radius..." etc. as tools execute. SSE events exist but frontend display needs verification. *(JIT feature)*
- [ ] **Avatar URL in system prompt** — GV explicitly tells AI to use `https://mattcmorrell.github.io/ee-graph/data/avatars/{person-id}.jpg`. Verify studio does this.
- [ ] **Blocks array vs single HTML string** — JIT uses `blocks[]` with typed renderers per block. Studio uses a single `card.html` string — one bad generation ruins the whole card. More fragile.

## Tier 3 — Unique Value Proposition

- [ ] **What-if branching** — Fork from decision points to explore parallel paths. The core innovation. Currently tree is strictly linear.
- [ ] **Compare mode** — Side-by-side view of two branches. This is what makes canvas > tabs.
- [ ] **Layout refinement for branching** — Column tracking doesn't handle deep/wide trees. Overlaps when 5+ levels deep.
- [ ] **Decision ↔ card linking** — Click a decision in the log to highlight the originating card on canvas. *(GV mockup feature)*

## Tier 4 — Polish & UX

- [ ] **Theme toggle** — Both source projects have dark/light switching with localStorage. Studio is dark-only.
- [ ] **Refocus indicator** — JIT has 2px purple border + 24px glow on selected cards. Studio's selected state is too subtle.
- [ ] **Prompt chip hover glow** — JIT has solid border + purple glow. Studio has solid border + dim background but no glow.
- [ ] **Block entry animations** — JIT has blockMaterialize (scale+blur), cascadeNodeIn, edgeDraw. Studio only has basic opacity+scale fade.
- [ ] **Error recovery UI** — No retry button or fallback if card render fails or API errors mid-exploration.
- [ ] **Keyboard shortcuts** — No Escape to deselect, no Cmd+0 for zoom-to-fit, no arrow navigation.
- [ ] **Graph metadata in header** — JIT shows node/edge counts in top bar. Studio has scenario title but no data context.
- [ ] **Theme passed to LLM** — GV sends current theme so generated HTML matches. Studio hardcodes dark theme assumptions.
- [ ] **Missing get_org_stats tool** — JIT has pre-computed rankings/distributions tool. Studio doesn't.
