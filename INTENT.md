# INTENT: EE Graph Studio

## Goal

Build the combined vision: Conversation + Canvas scenario planning. The user has a conversation with the AI while the AI draws visual cards on a spatial canvas. Decisions accumulate in a shopping cart. The core interaction is what-if branching — exploring futures, comparing options, choosing and executing.

This combines findings from all three experiments:
- Progressive disclosure interaction model (Exp 1)
- Atomic design patterns for visual consistency (Exp 2/3 hybrid)
- Generative visuals from graph data (Exp 3)

## Current Direction

**Scenario mode (new, primary focus).** A new interaction paradigm validated through 4 rounds of mockups. Three-pane layout: nav list (left) + spatial canvas (center) + conversation (right).

**Architecture:**
- Left: Flat nav list of top-level impact domains (the "jobs to be done"). Big selectable cards with icon, title, severity, meta. Decision cart at bottom.
- Center: Spatial canvas for the selected domain. Entity card as root, impact cards, comparison columns, consequence cards — all with connector lines. Depth grows on the canvas.
- Right: One continuous conversation thread shared across all domains. Conversation is the brain; canvas is a projection of conversation state.

**Card paradigm — decomposed cards:**
- Entity cards: lightweight identity (person, team, policy, capability) with status badge
- Impact domain cards: one per consequence area (Compliance, Staffing, etc.) with domain-specific content, CTA ("Buy button"), and collapsed explore bar
- Comparison columns: side-by-side options when a domain reaches a decision point (branching is NOT a separate mode — it's what happens inside an impact domain with competing options)
- Consequence cards: downstream effects of a decision, which can themselves become new explorable nodes

**Card interaction — collapsed explore bar (Approach A):**
- Each impact card has: content body → CTA button (always visible, prominent) → collapsed "Explore" bar
- Click explore bar → reveals prompt chips (blue=knowledge, green=action) + text input for custom questions
- Only one card's prompts visible at a time
- After selecting a prompt: chips disappear, badge shows what was explored, result appears as child cards

**Two-phase AI response:**
1. Initial: User describes scenario → AI returns entity + impact domains → nav populates, entity appears on canvas
2. Exploration: User selects a domain → AI returns canvas card + prompts → card appears on canvas with explore bar

**Key architectural decisions (validated):**
- Conversation is ONE thread across all domains — never splits
- Canvas can be "off" — not every message needs a visual
- AI routes visual output to the correct domain
- Clicking prompt chips = sends message to conversation
- Dismiss/defer/save-for-later on impact domains (nav cards)
- Decision cart in nav panel, separate from exploration

**Existing modes (paused):**
1. **Analysis**: Canvas tree with prompt chips. Still works, but scenario mode supersedes it.
2. **Branching**: Comparison columns. Absorbed into scenario mode (branching happens within impact domains).
3. **Allocation**: Scenario planning with group buckets. Independent use case, paused.

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

## Key Insights

**Human-edit → AI re-analysis is the killer feature.** The allocation mode's flow — AI suggests a scenario, user drags people between groups, analysis goes stale, user clicks "Analyze changes", AI provides fresh assessment of the edited state — is the standout interaction pattern. It's not just AI-generates-everything; it's AI-suggests → human-tweaks → AI-reacts. The stale indicator + batch analyze pattern (don't auto-analyze every edit, let the user trigger when ready) should be the template for future interaction modes.

**Every card is a rabbit hole. Decisions are exits, not gates.** The canvas has two interweaving tracks: analysis (infinite depth) and decisions (available at any point). Every card should have an explore bar (primary affordance) that invites deeper exploration, plus an optional decision CTA (secondary) for when the user has seen enough. Don't force decisions at a specific depth — the user takes the exit when they're ready. After deciding, "explore ramifications" opens a new explorable branch. The canvas is a choose-your-own-adventure, not a step-by-step wizard.

## What Needs Work

- **Decomposed impact areas (biggest priority)**: Instead of one big dense card per domain, AI should break the analysis into multiple smaller horizontal nodes (e.g., "Manager Gap" + "Team Risk" + "Project Exposure" as siblings). Reduces cognitive load per card, makes the canvas actually useful for spatial reasoning. Requires changes to the AI response format and possibly the prompt.
- **Explore-then-decide flow**: Every card gets explore bar (primary) + optional CTA (secondary). Candidate detail cards invite exploration before committing. Comparison candidates should branch into impact analysis before the user has to choose. After deciding, "explore ramifications" spawns new branch.
- **Button loading states**: CTAs and explore prompts need loading indicators while AI is thinking.
- **Chat position exploration**: Evaluate center-of-page (Google Stitch style) vs current sidebar. Advantages/disadvantages TBD.
- **Prompt fix**: "Assign Interim Manager" CTA should present candidates as `options`, not skip to direct assignment.
- **Canvas context for AI**: `buildAllocContext()` works for allocations. May need to extend to all canvas cards so AI knows what analysis already exists.

## Rejected Approaches

- **Typed block renderers (primitives.js)**: Built client-side renderers for 6 block types (person_card, metric_row, impact_card, cascade_path, action_list, narrative). The AI output typed JSON, client rendered it. Rejected because it was too limiting — GPT-5.4 composes better visuals when generating HTML freely from atomic patterns than when constrained to pre-defined block types. The GV approach (atomic patterns as prompt guidance + raw HTML output) produces richer, more varied layouts.
- **Colored left borders on severity blocks**: Looks like a sidebar nav, not a data card. Banned.
- **Colored background gradients on blocks**: Makes cards look heavy and garish. Color only in small elements (badge pills, tag chips).

## Scenario Mode — Build Plan

### Phase 1: Skeleton + Nav Panel (DONE)
- [x] `modes/scenario.js` registered as new mode
- [x] `MODE_PROMPTS['scenario']` with two-phase response format on server
- [x] Nav panel injects on left: entity header, flat domain card list, decision cart with "Put plan into action"
- [x] AI's Phase 1 response returns entity + domains → nav populates
- [x] Clicking domain card sends exploration message to AI
- [x] AI's Phase 2 response returns canvas card + prompts
- [x] Entity card renders as canvas root
- [x] Canvas cards render with explore bar (prompt chips + text input)
- [x] Connector lines (SVG overlay) between parent/child cards
- [x] Default decision log hidden; replaced by in-nav version
- [x] Script tag added to index.html, CSS added to styles.css

### Phase 1.5: Conversation-Mediated Domain Selection (DONE)
- [x] **Domain proposals in conversation**: AI's initial response returns `proposedDomains` as selectable chips in the conversation pane. Each chip shows severity tag (HIGH/MED/LOW) + title + meta. High-severity domains pre-selected. Click to toggle.
- [x] **Confirm selection**: "Explore N areas" button. On click → selected domains populate nav, entity renders on canvas, AI auto-explores first domain.
- [x] **Server prompt update**: `proposedDomains` field in Phase 1 response. Phase 1b confirmation handled client-side. AI instructed not to assume user wants all domains.
- [x] **Unselected domains**: Stored in `proposedDomains` array for later access. Selected chips dim after confirm, unselected fade out.

### Phase 2: Canvas Cards + Layout (MOSTLY DONE)
- [x] **Progressive streaming**: entity_preview SSE event + canvas placeholder cards with live status messages. Entity appears at ~3s, badge animates on when full result arrives.
- [x] **Layout engine**: Bottom-up size calculation, top-down placement. Cards auto-space based on subtree width. Animated repositioning.
- [x] **Card positioning**: Entity at top-center. Impact cards below. Comparison columns as siblings. Consequence cards below.
- [x] **Connector lines**: Bezier curves from parent center-bottom to child center-top. Redraw on layout changes.
- [x] **Card states**: Fresh (CTA + collapsed explore) → Exploring (prompts visible) → Acted (badge + child cards). One card in Exploring state at a time.
- [x] **Focus management**: Click card to focus (glow border). Only focused card's explore bar expandable. Others dim.
- [x] **Drill-down stats**: `data-drill` / `fetchDrillData()` pattern ported from analysis mode.
- [x] **Canvas auto-navigate**: "New card below" indicator pill. FocusOn for comparison columns.
- [ ] Connector line fading for inactive branches (not done)

### Phase 3: Comparison + Decisions (MOSTLY DONE)
- [x] **Comparison columns**: Two layouts with toggle — full-row (330px cards, horizontal pan) and compact (160px individual nodes, click to expand detail). Compact is now default.
- [x] **Ghost write-in**: "Suggest another" button sends message to AI.
- [x] **Decision flow**: Choose → decided card highlights, siblings dim → AI responds with consequences → decision logged.
- [x] **Decision cart**: Floating window, appears when first decision added. Clickable decisions navigate to source card (across domains).
- [x] **CTA actions**: CTA buttons on cards send action messages to AI.
- [x] **AI recommendation**: AI returns `recommend` field, client badges the allocation + banner.
- [ ] CTA "Assign Interim Manager" should present candidates as `options` first (prompt fix needed)

### Phase 4: Depth + Polish (PARTIAL)
- [x] **Domain switching**: Canvas state preserved per domain. Camera position saved/restored exactly. Cross-domain responses stashed silently.
- [x] **Zoom-to-fit**: FocusOn last node on domain switch (not zoom-to-fit which was too aggressive).
- [x] **Loading states (partial)**: Canvas placeholder cards show status during streaming. Allocation chips disabled during streaming. Button loading states still needed.
- [ ] **Progressive abstraction**: Parents fade to compact summaries as user goes deeper (not done)
- [ ] **Domain status updates**: Active/Done/Later on nav cards (not done)
- [ ] **Dismiss/defer on nav cards** (not done)
- [ ] **Cross-domain references** (not done)
- [ ] **Button loading states**: CTAs + explore prompts need loading indicators

### Phase 5: Allocation Integration (DONE)
- [x] All items complete (drag-and-drop, stale analysis, decide, duplicate, domain switching, canvas context injection, AI recommendation badges)

### Phase 6: Interaction Model Rethink (NEXT — Monday)
- [ ] **Decomposed impact areas**: AI breaks domain analysis into multiple horizontal nodes instead of one dense card. Consider new branch for this — significant change to response format.
- [ ] **Explore-then-decide**: Every card gets explore bar (primary) + CTA (secondary). Exploration before commitment. Ramifications after commitment.
- [ ] **Chat position**: Evaluate center-of-page vs sidebar

### Future (not scoped yet)
- Execute decisions: batch commit flow with confirmation
- Topic pivots: user changes subject entirely → AI archives current canvas
- Multi-entity scenarios: comparing two different trigger events
- Canvas overview/minimap for orientation in deep trees
- Export: decision summary as PDF/markdown

## Open Questions

- How should the layout engine handle comparison columns (horizontal) within a vertical tree? Fixed width per column, or dynamic based on content?
- Should the AI be allowed to update/modify existing canvas cards, or only add new ones?
- When should we split to multi-LLM (orchestrator + renderer)? Not needed for Phase 1-2, maybe Phase 3+.
- How to handle free-text input that doesn't clearly belong to the active domain? Route to conversation only, or create a new domain?
