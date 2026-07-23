// Vercel serverless function — POST /api/food-lookup
// Uses Claude Haiku exclusively. Set ANTHROPIC_API_KEY in Vercel env vars.
// Returns: {"name":"...","kcal":number,"protein":number,"unknown":boolean}

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) throw new Error('No JSON object found in model response');
  return JSON.parse(text.substring(start, end + 1));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST method required' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  const foodQuery = body?.query || body?.prompt;
  if (!foodQuery || typeof foodQuery !== 'string') {
    return res.status(400).json({ error: 'Food query text is required.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY is not set in Vercel environment variables.');
    return res.status(500).json({
      error: 'ANTHROPIC_API_KEY not configured. Add it in Vercel → Settings → Environment Variables, then redeploy.'
    });
  }

  const system = `You are a nutrition database. Return ONLY a raw JSON object — no markdown, no explanation, no extra text.

Schema: {"name":"short item name under 40 chars","kcal":number,"protein":number,"unknown":false}

Set "unknown":true if genuinely unsure (home cooking, vague descriptions). Always provide a numeric estimate regardless.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 80,
        system,
        messages: [{ role: 'user', content: foodQuery }]
      })
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      const errMsg = errBody?.error?.message || errBody?.type || `HTTP ${response.status}`;
      console.error('Claude API error:', errMsg);
      return res.status(502).json({ error: `Claude API error: ${errMsg}` });
    }

    const data = await response.json();
    const rawText = data?.content?.[0]?.text || '';
    const parsed = extractJson(rawText);

    if (typeof parsed.kcal !== 'number') throw new Error('Response missing kcal field');

    return res.status(200).json(parsed);

  } catch (e) {
    console.error('Food lookup failed:', e.message);
    return res.status(502).json({ error: `Food lookup failed: ${e.message}` });
  }
};
