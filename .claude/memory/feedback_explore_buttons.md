---
name: Explore button design
description: Featured/CTA prompt is solid accent, secondary prompts are 2px outlined, all full-width stacked
type: feedback
---

Explore bar buttons use a two-tier system: the AI's recommended next step is a solid accent fill button, regular explore prompts are 2px outlined with no fill and bold accent text. All buttons are the same height, full-width, stacked vertically. No arrows in the featured button.

**Why:** CTAs were green "commit" buttons that conflicted with actual decision buttons and clashed spatially with the explore section. The featured prompt replaces the CTA — phrased as exploration ("Who should take over?") not a command ("Assign Interim Manager").

**How to apply:** When the AI has a recommended next step, it goes in the `cta` field which renders as the featured solid button inside the explore bar. Regular prompts render as outlined buttons below it.
