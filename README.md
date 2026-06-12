# EE Graph Studio

Canvas-based scenario planning tool. Users have a conversation with AI while it draws visual cards on a spatial canvas. Decisions accumulate in a shopping cart. The core interaction is what-if branching.

## Branches

| Branch | Purpose |
|--------|---------|
| **`shrm-kiosk-fast-model`** | **Canonical branch for the SHRM kiosk demo. All kiosk work goes here.** |
| `shrm-kiosk` | Earlier kiosk iteration, superseded by fast-model |
| `shrm-kiosk-static` | Fully static variant (no Express, client-side OpenAI) |
| `shrm-kiosk-gemini-only` | Gemini-powered variant |
| `shrm-kiosk-visual-explore` | Visual exploration variant |
| `main` | Base branch |

## Running locally

```bash
npm install
cp .env.example .env  # add your OpenAI key
node server.js        # runs on port 3460
```
