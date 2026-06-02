# INTENT: EE Graph Studio

## Goal

Build the combined vision: Conversation + Canvas scenario planning. The user has a conversation with the AI while the AI draws visual cards on a spatial canvas. Decisions accumulate in a shopping cart. The core interaction is what-if branching — exploring futures, comparing options, choosing and executing.

**SHRM 2026 Kiosk Demo** (~3 weeks out): 49" touchscreen at BambooHR's booth. Voice-first with touch fallback. The demo needs to feel agentic — visitors should see AI thinking, building analysis in real time, not just a dashboard of pre-made cards. Voice is the wow factor. Touch (Explore prompts, drillable stats) is the reliable foundation.

## Current Direction

### Active Branches

**`shrm-kiosk`** — Base branch. Gemini Live voice integration + canvas card rendering via tool calls. Voice and text are separate pipelines (Gemini for voice, OpenAI for text/clicks). Working well.

**`shrm-kiosk-fast-model`** — Performance optimizations on the OpenAI text pipeline:
- `gpt-5.4-mini` instead of `gpt-5.4` (faster, cards still good)
- `parallel_tool_calls: true` (OpenAI batches graph queries, fewer API round trips — noticeably faster)
- Parent-child fix: click context (`pendingParentCardId`) ALWAYS wins over AI's self-generated `parentId` (fixed in both `handleCardResponse` and `handleCardsResponse`)
- Server-side retry when model returns text-only (no cards) — nudges model to regenerate with cards instead of showing a dead-end fallback
- Prompt reinforcement: "EVERY response MUST include at least one card"

**`shrm-kiosk-gemini-only`** — Option B: route ALL interactions through Gemini (not just voice). Foundation built:
- `voice.connect()` — text-only WebSocket connection (no mic)
- `voice.sendText(text)` — sends text through Gemini Live API
- Auto-connect on page load with `?voice=1`
- `window._voiceGemini` bridge for scenario.js
- `handleSendMessage` tries Gemini first, falls back to OpenAI
- **Not yet tested end-to-end. Next steps:** test text routing, handle loading state, route starter prompts, cherry-pick parent fix.

**`shrm-kiosk-visual-explore`** — Explored alternative visual paradigm: cards as inline conversation artifacts instead of branching tree. Vertical scroll, current turn centered, previous turns fade behind gradient. Mockup at `public/mockups/voice-cards-A-inline-v1.html`. **Parked** — decided the branching tree is more powerful for showing spatial memory on a 49" screen. Voice provides the narrative thread, tree provides the visual one.

### Key Decisions Made This Session

1. **Voice cards need rich HTML instructions** — Gemini was generating thin cards because it only had 7 lines of HTML guidance vs OpenAI's 160 lines. Ported full atomic patterns (Person Lockup, Stat Block, Section Block, Bar, Data Row, Tag, Drillable Stats) into Gemini's prompt. Cards now include severity pills, bars, data rows. Prompts required on every card.

2. **Batch mode only for Gemini voice** — Tested streaming (show_card called mid-speech). Gemini 3.1 Flash Live only supports synchronous tool calling — tools always batch before/after speech, never interleaved. Streaming mode produced identical card timing to batch with worse UX. Removed streaming toggle entirely.

3. **Cross-pipeline parent fix** — When clicking Explore on a Gemini-created card, OpenAI's self-generated `parentId` values don't match existing canvas cards. Fix: client-side click context (`pendingParentCardId`) always takes priority over AI's parentId. Applied to both singular and plural card response handlers.

4. **"Speak first" doesn't work** — Tried prompting Gemini to speak an acknowledgment before calling tools. Gemini treated the acknowledgment as its complete response and stopped. Reverted to silent-then-speak flow with a thinking indicator (shimmer orb + "Thinking..." text).

5. **Hybrid pipeline is the practical approach** — Gemini for speed/voice overview, OpenAI for rich follow-up cards when clicking Explore. Both produce cards on the same canvas. The parent fix makes this work seamlessly.

6. **Tree > inline cards for kiosk** — The branching tree provides spatial memory on a 49" screen. Voice provides narrative continuity. Don't need to flatten to a scrolling timeline — the tree IS the demo.

## What's Done

### Voice Integration (shrm-kiosk)
- Gemini Live voice via raw WebSocket (BidiGenerateContent)
- Card tool declarations: `show_cards` (batch), `show_comparison`, `set_root`
- Voice-canvas bridge (`window._voiceCanvas`) routes Gemini tool calls to existing card renderer
- Card tree structure: `parentId` on follow-up cards, `rendered_card_ids` in tool responses
- Voice messages identical to typed messages in chat thread
- Auto-scroll during voice conversation
- Thinking indicator: shimmer gradient orb + "Thinking..." during tool processing
- On-screen debug log for tool calls (can't open browser console in cmux)
- Full atomic patterns in Gemini prompt (same design system as OpenAI)
- Drillable stats in Gemini prompt (never paginate lists across cards)
- Prompts required on every card (`required: ['id', 'title', 'html', 'prompts']`)

### Performance (shrm-kiosk-fast-model)
- `gpt-5.4-mini` model swap
- Parallel tool calls enabled
- Parent-child resolution fixed (click context wins)
- Server-side retry for missing cards
- Drillable stat boxes have visible border + 28px accent caret

### All prior work (scenario mode phases 1-6, allocation, decomposed cards, etc.)
See git history on `main` branch.

## What Needs Work (Kiosk Prep)

### Must Have
- [ ] **Merge fast-model fixes to shrm-kiosk** — parent fix, parallel calls, card retry
- [ ] **Test Option B end-to-end** — does text routing through Gemini actually work?
- [ ] **Pre-seeded scenario** — boot into already-explored "Raj Patel resigned" so visitors see cards immediately
- [ ] **Touch target enlargement** — 60px+ tap targets for all interactive elements
- [ ] **Simplify chrome** — strip top bar (no theme toggle, no "New Scenario", no Fit button)
- [ ] **Canvas readability** — bump font sizes for arm's-length reading on 49" screen
- [ ] **Idle timeout/auto-reset** — reset to pre-seeded state after inactivity

### Nice to Have
- [ ] **Mic controls UI** — settings gear, mic toggle, speaker with volume slider, "Live" connection indicator (reference: matt-m/shrm-touchscreen-demos)
- [ ] **Auto-navigation** — camera follows new cards automatically
- [ ] **Starter prompts route through Gemini** — even touch triggers the agentic voice experience

## Rejected Approaches

- **Gemini Live streaming card generation** — 3.1 Flash only supports synchronous tool calling. Cards always batch, never interleave with speech. (exp-1, dec-voice-batch)
- **"Speak first, then tools" prompting** — Gemini treats the spoken acknowledgment as a complete response and stops. No reliable way to force speak-then-tool ordering.
- **Client-side fallback cards** — wrapping text-only responses in a card div was a dead end (no data, no explore prompts). Server-side retry is better.
- **Inline card stage (voice-cards mockup)** — scrolling timeline of card groups. Clean but loses spatial memory. Tree + voice is more powerful for the kiosk demo.

## Open Questions

- Should Option B (all-Gemini) replace the hybrid (Gemini voice + OpenAI text), or should hybrid be the production approach with Option B as the aspirational target?
- How to handle Gemini context saturation for longer demo sessions? (5-8 rounds of rich cards may fill context)
- Is `gpt-5.4-mini` good enough for card quality, or should we use full `gpt-5.4` and accept the latency?
