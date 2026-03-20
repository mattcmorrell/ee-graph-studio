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

### Phase 2: Canvas Cards + Layout
- [ ] **Progressive streaming**: Server emits intermediate SSE events as the AI discovers things, not just one final result. Flow: (1) AI calls `search_people` → server emits `{ type: 'entity' }` → entity card appears on canvas immediately. (2) AI understands the context (resignation, reorg, etc.) → server emits `{ type: 'entity_update', badge }` → badge animates onto existing card. (3) AI identifies domains → server emits `{ type: 'domains' }` → nav populates progressively. (4) Final `result` with conversational message. Makes the tool feel alive instead of "wait 10 seconds then everything appears."
- [ ] **Layout engine**: Bottom-up size calculation, top-down placement. Cards auto-space based on subtree width. No overlap. Animated repositioning when new cards appear.
- [ ] **Card positioning**: Entity at top-center. Impact cards below. Comparison columns below impact cards. Consequence cards below comparisons. Each level centers under its parent.
- [ ] **Connector line refinement**: Bezier curves from parent center-bottom to child center-top. Redraw on layout changes. Lines should fade for inactive branches.
- [ ] **Card states**: Fresh (CTA + collapsed explore) → Exploring (prompts visible) → Acted (badge + child cards). Only one card in Exploring state at a time.
- [ ] **Focus management**: Clicking a card focuses it (glow border). Only focused card's explore bar is expandable. Other cards dim slightly.
- [ ] **Drill-down stats**: Reuse `data-drill` / `fetchDrillData()` pattern from analysis mode for inline stat expansion within cards.
- [ ] **Canvas auto-navigate**: Smooth pan to new cards as they appear. "AI drew something" indicator if user has scrolled away.

### Phase 3: Comparison + Decisions
- [ ] **Comparison columns**: When AI returns `options`, render as side-by-side comparison columns (not small option cards). Each column: avatar, name, role, key metrics, strengths/risks. "Choose" button per column.
- [ ] **Ghost write-in**: "+ Suggest another" column that sends a message to the AI asking for more options.
- [ ] **Decision flow**: Click "Choose" → column highlights as decided, siblings dim → AI responds with consequences → decision added to cart → consequence cards appear below on canvas.
- [ ] **Decision cart sync**: Decisions appear in nav panel cart in real-time. Remove button works. Cart shows domain source per decision.
- [ ] **CTA actions**: "Approve Compliance Plan", "Assign Interim Manager" etc. — clicking sends a specific action message to the AI, which records it as a decision and shows confirmation/consequences.

### Phase 4: Depth + Polish
- [ ] **Progressive abstraction**: As user goes deeper, parent levels fade to compact summaries. Active level gets full detail. Clicking a faded parent re-expands it and fades the children.
- [ ] **Domain switching**: Clicking a different nav card swaps the canvas to that domain's tree. Each domain's canvas state is preserved independently.
- [ ] **Domain status updates**: Nav cards update their status (Active, Done, Later) and meta text as exploration progresses. AI can update domain status in responses.
- [ ] **Dismiss/defer**: Star button on nav cards to defer a domain (dims it, moves to bottom). X button to dismiss. Deferred domains show in a "Later" section.
- [ ] **Zoom-to-fit**: Works with the new layout. Accounts for nav panel width.
- [ ] **Loading states**: Pulsing/skeleton on explore bar while AI responds. Disable prompt chips during streaming.
- [ ] **Cross-domain references**: If the AI's response references another domain (e.g., staffing consequence affects compliance), show a subtle link/badge.

### Phase 5: Allocation Integration — UP NEXT

**Goal:** Integrate the allocation mode's "human-edit → AI-react" interaction into Scenario mode. When exploring staffing/team domains, the user can directly manipulate team assignments (drag people between groups), then have the AI analyze consequences. This is the standout interaction pattern identified in INTENT.md's Key Insight section.

**Reference implementation:** `modes/allocation.js` has all the building blocks — bucket rendering, drag-and-drop, undo strip, stale analysis, AI re-analysis. Port and adapt for the canvas card system.

#### Step 1: Server — Allocation Response Type
- [ ] Add new response type to `MODE_PROMPTS['scenario']`: when the AI determines a question involves resource reassignment (e.g., "split Raj's team", "reassign people", "restructure the team"), it returns an `allocation` field instead of (or alongside) a card.
- [ ] Allocation response format:
  ```json
  {
    "message": "Here's the current team layout. Drag people between groups to explore different structures.",
    "allocation": {
      "id": "alloc-staffing-split",
      "title": "Team Reassignment",
      "groups": [
        {
          "id": "group-lisa",
          "title": "Lisa Huang's Group",
          "people": [
            { "id": "person-042", "name": "Lisa Huang", "role": "Infrastructure Lead", "initials": "LH" },
            { "id": "person-101", "name": "Derek Lin", "role": "Engineer", "initials": "DL" }
          ]
        },
        {
          "id": "group-tom",
          "title": "Tom Walsh's Group",
          "people": [...]
        }
      ]
    },
    "card": null,
    "prompts": [...]
  }
  ```
- [ ] AI should populate groups with REAL people from graph queries — actual direct reports, actual team assignments
- [ ] Include the prompt guidance: "When the user asks about splitting teams, reassigning people, or restructuring, return an allocation response. The user will drag people between groups, then ask you to analyze."

#### Step 2: Client — Allocation Canvas Card
- [ ] New function `renderAllocation(data.allocation, parentCardId)` in `scenario.js`
- [ ] Creates a wide canvas card containing:
  - **Title bar** with the allocation title
  - **Undo strip** — shows last move ("You moved Derek Lin from Lisa's Group to Tom's Group") with Undo button. Hidden when no moves made.
  - **Group buckets** — horizontal row of named columns, each containing person chips
  - **Person chips** — avatar initials + name + role, draggable
  - **"Analyze changes" button** — sends current state to AI for re-analysis
  - **"Decide this scenario" button** — commits the current allocation as a decision
- [ ] Add to canvas tree as a child of the parent card, like comparison columns
- [ ] Layout engine handles the wide allocation card

#### Step 3: Drag-and-Drop
- [ ] Port drag logic from `modes/allocation.js`:
  - `pointerdown` on person chip → create drag clone, attach to pointer
  - `pointermove` → move clone, highlight drop target bucket on hover
  - `pointerup` → if over a different bucket, move the person chip there
- [ ] Track moves in an undo stack: `[{ personId, fromGroupId, toGroupId }]`
- [ ] Update group headers with count and delta (e.g., "4 (+1)")
- [ ] Show moved chips with dashed border ("moved by you" indicator)

#### Step 4: Stale Analysis + Re-analyze
- [ ] After any drag-and-drop move, mark the analysis as "stale"
  - Show "Stale — re-analyze" badge on the analysis section
  - Previous analysis insights show with "may no longer apply" dimming
- [ ] "Analyze changes" button:
  - Sends current allocation state to AI: "Analyze this team configuration: [group assignments as JSON]"
  - AI responds with fresh analysis (metrics + insights)
  - Analysis section updates, "stale" clears
- [ ] Don't auto-analyze every move — let the user batch edits and trigger when ready (validated pattern from allocation mode)

#### Step 5: Decide + Commit
- [ ] "Decide this scenario" button:
  - Creates a decision entry with all moves summarized: "Reassigned 3 engineers: Derek Lin → Tom's group, Clara Fox → Lisa's group, etc."
  - Adds to decision cart in nav panel
  - Allocation card shows "Decided" state (green border, disabled dragging)
  - AI can generate a consequences card below showing impact of the restructuring
- [ ] "Duplicate" button (stretch): clone the allocation card to explore an alternative split without losing the first one

#### Step 6: CSS
- [ ] Port allocation-specific styles from styles.css (lines ~1766-2162):
  - `.alloc-bucket`, `.alloc-chip`, `.alloc-chip-moved`
  - `.alloc-analysis`, `.alloc-stale`
  - `.alloc-undo-strip`
  - Adapt class names to `scenario-alloc-*` namespace
- [ ] Ensure allocation card works within the canvas card system (absolute positioning, layout engine sizing)

#### Key Files to Reference
- `public/modes/allocation.js` — full allocation mode implementation (drag-drop, undo, analysis, bucket rendering)
- `public/styles.css` lines ~1766-2162 — allocation mode CSS
- `server.js` `MODE_PROMPTS['allocation']` — allocation mode AI prompt (response format for groups/analysis)

#### Integration Notes
- The allocation card is triggered by AI intelligence, not user mode switching. The AI decides when a question warrants an allocation view vs. a regular analysis card vs. comparison columns.
- The allocation card lives on the canvas like any other card — it has a parent, connectors, and participates in the layout engine.
- The undo stack is per-allocation-card, not global.
- The "Analyze changes" flow reuses `S.callChat()` but with a special message format that includes the current group state as JSON.
- The conversation stays unified — allocation moves show in the conversation as user actions, AI analysis shows as AI messages.

### Phase 4 Remaining (lower priority)
- [ ] Progressive abstraction (parents fade deeper)
- [ ] Domain status updates (Active/Done/Later)
- [ ] Dismiss/defer on nav cards
- [ ] Cross-domain references

### Phase 2 Deferred
- [ ] Progressive streaming (entity appears immediately — server SSE rework)

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
