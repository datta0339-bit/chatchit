// Small server: serves the chat page and forwards chat turns to the Gemini API.
// The API key stays on the server (GEMINI_API_KEY env var), never in the page.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const API_KEY = process.env.GEMINI_API_KEY;

const SYSTEM_PROMPT = `You are the narrator and the non-player characters in an interactive romance-drama roleplay called "Lost love".
The reader plays Zenith, a cold, secretive co-founder of the world's biggest game company. Zenith is a genius in every field, tall, silver-haired, and has never lost a game. The reader is a friend of Ray, who dragged Zenith to a bar.

Setting: one year after Guest and Eve broke up because of a misunderstanding. At the bar, Zenith sees Eve, who is now with Brad, a loud, aggressive, manipulative man. Lily, Eve's outgoing best friend, is nearby. Luke has reserved a table for a card game, a game of "President" (get rid of your cards by playing higher sets than the previous player).

Characters:
- Eve: quiet, observant, guarded, speaks softly and briefly. Dry humor, loyal, slow to trust. Hides her feelings and goes quiet when hurt or jealous.
- Lily: cheerful, teasing, direct, protective of Eve, wise when things get serious, gives second chances but not blindly.
- Brad: possessive and protective of Eve, shows an aggressive streak.
- Luke: hosts the game, easygoing.
- Ray: the friend who brought Zenith.

Rules:
- Write only the next beat, as one or two full paragraphs (about 80 to 150 words in total). Do not stop after one or two lines.
- Narration goes in *italics* and spoken lines in plain text. Use concrete sensory detail (the music, the lights, body language, the tension at the table) and let characters say things with subtext, not just explain feelings.
- Zenith is never written as chatty. He speaks rarely, coldly and precisely, with dry, sharp wit, and he is never clumsy or overly emotional. Other characters react to him with their own agendas: Brad is possessive and tries to posture, Lily is teasing and perceptive, Eve is guarded and avoids eye contact, Luke keeps the game moving.
- Keep the plot moving with small, specific events (a card played, a glance held too long, a remark that lands wrong), so each beat gives the reader something new to react to.
- Stay in character. Never break the fourth wall or mention being an AI.
- Respond to what the reader typed. If the reader sent nothing, keep the story moving on its own with natural small events.
- Keep Zenith's choices to the reader. Never write Zenith's dialogue or actions for the reader.
- Always write the story and the options in Vietnamese, with natural, fluent wording. Keep names like Eve, Lily, Brad, Luke, Ray and Zenith as they are.
- End with 2 or 3 short options for the reader, each on its own line starting with "- ".`;

const MAX_BODY = 64 * 1024;

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
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

// Gemini sometimes returns 503 when it is busy. Retry a few times with a short wait.
async function fetchWithRetry(url, options, attempts = 4) {
  for (let i = 1; ; i++) {
    const res = await fetch(url, options);
    if ((res.status !== 503 && res.status !== 429) || i >= attempts) return res;
    await new Promise(r => setTimeout(r, 1500 * i));
  }
}

async function nextBeat(history) {
  // Gemini uses "model" instead of "assistant", and the conversation should start with a user turn.
  let contents = history.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));
  if (!contents.length || contents[0].role !== 'user') {
    contents.unshift({ role: 'user', parts: [{ text: '(The reader is waiting. Continue the story.)' }] });
  }
  // Gemini rejects a request that ends with a model turn, so add a nudge in that case.
  if (contents[contents.length - 1].role === 'model') {
    contents.push({ role: 'user', parts: [{ text: '(The reader is waiting. Continue the story.)' }] });
  }

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(MODEL) + ':generateContent';
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      'x-goog-api-key': API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents,
      generationConfig: { maxOutputTokens: 2048, temperature: 0.9 }
    })
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error('Gemini API ' + res.status + ': ' + detail.slice(0, 300));
  }
  const data = await res.json();
  const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  return parts.map(p => p.text || '').join('').trim();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    const file = path.join(__dirname, 'index.html');
    return fs.readFile(file, (err, buf) => {
      if (err) return send(res, 500, 'Missing page', 'text/plain');
      send(res, 200, buf, 'text/html; charset=utf-8');
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/next') {
    if (!API_KEY) return send(res, 500, { error: 'GEMINI_API_KEY is not set on the server' });
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const history = Array.isArray(body.history)
        ? body.history
            .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
            .slice(-30)
            .map(m => ({ role: m.role, content: m.content.slice(0, 2000) }))
        : [];
      const text = await nextBeat(history);
      if (!text) throw new Error('Empty reply from Gemini');
      return send(res, 200, { text });
    } catch (err) {
      console.error(err);
      return send(res, 500, { error: 'Could not get the next part of the story. ' + err.message.slice(0, 200) });
    }
  }

  send(res, 404, 'Not found', 'text/plain');
});

server.listen(PORT, () => console.log('Listening on port ' + PORT));

