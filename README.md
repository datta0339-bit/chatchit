# chatchit

Zeta-style roleplay chat. The opening is fixed. Claude writes the rest, either from the reader's typed text or when the reader taps "Để AI viết tiếp".

## Files

- `server.js`: serves `public/index.html` and handles `POST /api/next`, which calls the Claude API.
- `public/index.html`: the chat page.

## Run locally

Needs Node.js 18 or newer.

```bash
ANTHROPIC_API_KEY=your-key npm start
```

Then open http://localhost:3000.

## Deploy on Render

1. Push this folder to the GitHub repo.
2. On render.com, choose **New > Web Service** and connect the repo.
3. Settings:
   - Runtime: Node
   - Build command: `npm install`
   - Start command: `npm start`
4. Under **Environment**, add `ANTHROPIC_API_KEY` with your key. Do not commit the key to GitHub.
5. Optional: add `CLAUDE_MODEL` to change the model (default `claude-sonnet-5-5`).
