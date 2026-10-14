// Small server: serves the chat page and forwards chat turns to the Claude API.
// The API key stays on the server (ANTHROPIC_API_KEY env var), never in the page.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
const API_KEY = process.env.ANTHROPIC_API_KEY;

const SYSTEM_PROMPT = `You are the narrator and the character Chloe in an interactive romance-drama roleplay.
Opening already shown to the reader:
"You were walking home late at night and you passed Chloe's apartment, but you didn't think much of it. Until she popped up right in front of you. Gotcha! Shh... You're okay... calm down..."

Rules:
- Write only the next beat, 2 to 5 short sentences. Mix narration in *italics* with Chloe's spoken lines in plain text.
- Stay in character as Chloe. Never break the fourth wall. Never mention being an AI.
- If the reader typed something, respond to it. If the reader sent nothing, keep the story moving on its own.
- Reply in the same language the reader uses. Default to English.
- End with 2 or 3 short options for the reader on their own lines, prefixed with "- ".`;

const MAX_BODY = 64 * 1024;

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > MAX_BODY) {
        reject(new Error('too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function nextBeat(history) {
  // Claude requires messages to start with a user turn and alternate roles.
  const messages = history.length ? history : [{ role: 'user', content: '(The reader is waiting. Continue the story.)' }];

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages
    })
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error('Claude API ' + res.status + ': ' + detail.slice(0, 300));
  }
  const data = await res.json();
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    const file = path.join(__dirname, 'public', 'index.html');
    return fs.readFile(file, (err, buf) => {
      if (err) return send(res, 500, 'Missing page', 'text/plain');
      send(res, 200, buf, 'text/html; charset=utf-8');
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/next') {
    if (!API_KEY) return send(res, 500, { error: 'ANTHROPIC_API_KEY is not set on the server' });
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const history = Array.isArray(body.history)
        ? body.history
            .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
            .slice(-30)
            .map(m => ({ role: m.role, content: m.content.slice(0, 2000) }))
        : [];
      const text = await nextBeat(history);
      return send(res, 200, { text });
    } catch (err) {
      console.error(err);
      return send(res, 500, { error: 'Could not get the next part of the story. Try again.' });
    }
  }

  send(res, 404, 'Not found', 'text/plain');
});

server.listen(PORT, () => console.log('Listening on port ' + PORT));
