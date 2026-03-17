# EE Graph Studio

> **Read `../KNOWLEDGE.md` first** for the full research framework. This project combines findings from all three experiments into a single tool.

## The Vision

Conversation + Whiteboard. Just-in-time UI + Atomic Primitives. Analysis + Action. All powered by the graph.

## What This Is

A canvas-based scenario planning tool. The user has a conversation with the AI while the AI draws visual cards on a spatial canvas. Decisions accumulate in a shopping cart. The core interaction is what-if branching.

## Tech Stack

- Server: Node.js + Express, port 3460
- LLM: OpenAI SDK (gpt-5.4) + dotenv
- Frontend: Single HTML page, vanilla JS, no framework
- Canvas: Spatial engine lifted from jit-ui-canvas (pan/zoom/positioning)
- Data: EE graph fetched from GitHub Pages at startup

## Key Files

- `server.js` — Express server, graph tools, LLM endpoint, system prompt
- `public/index.html` — Shell page
- `public/canvas-engine.js` — Spatial viewport engine (pan/zoom/blocks)
- `public/app.js` — Main application logic, state, layout, conversation
- `public/styles.css` — All styling

## Architecture

- **Conversation pane** (right) — chat between user and AI
- **Canvas** (center/left) — spatial whiteboard where AI places visual cards
- **Decision log** (collapsible sidebar) — shopping cart of decisions made

## Design Rules

- **No colored left-border strokes on cards/blocks.** Don't use `border-left: 4px solid {color}` for severity indicators or any other purpose.
- **No colored background gradients on cards/blocks.** Don't use `background: linear-gradient(... {color-dim} ...)` to tint blocks by severity. Use flat section backgrounds (#2a2a2a). Color should only appear in small elements like badge pills and tag chips, not as block-level fills.

## Data Source

Acme Co Employee Experience Graph (~648 nodes, ~3,104 edges).
- Nodes: https://mattcmorrell.github.io/ee-graph/data/nodes.json
- Edges: https://mattcmorrell.github.io/ee-graph/data/edges.json
