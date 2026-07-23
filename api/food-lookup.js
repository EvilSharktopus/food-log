// Vercel serverless function — POST /api/food-lookup
// Returns: {"name":"...","kcal":number,"protein":number,"unknown":boolean}
// unknown=true means the model is guessing — UI should show editable fields

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

  const anthropicKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  const geminiKey = process.env.GEMINI_KEY || process.env.VITE_GEMINI_KEY;

  const systemInstruction = `You are a nutrition database. Return ONLY a raw JSON object — no markdown, no explanation, no extra text.

Schema:
{"name":"short item name","kcal":number,"protein":number,"unknown":false}

Rules:
- Set "unknown":true if you are genuinely unsure (home cooking, vague descriptions, made-up foods). Still provide your best numeric estimate.
- Set "unknown":false for named packaged foods, restaurant items, or common whole foods where you have reasonable data.
- "kcal" and "protein" are always numbers (never null).
- Keep "name" under 40 characters.`;

  // Try Claude API first
  if (anthropicKey) {
    try {
      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-20241022', // cheaper/faster than sonnet for this task
          max_tokens: 80,
          system: systemInstruction,
          messages: [{ role: 'user', content: foodQuery }]
        })
      });

      if (claudeRes.ok) {
        const data = await claudeRes.json();
        const rawText = data?.content?.[0]?.text || '';
        const parsed = JSON.parse(rawText.replace(/```json/g, '').replace(/```/g, '').trim());
        if (typeof parsed.kcal === 'number') return res.status(200).json(parsed);
      }
    } catch (e) {
      console.warn('Claude lookup failed:', e.message);
    }
  }

  // Fallback to Gemini
  if (geminiKey) {
    try {
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: systemInstruction + '\n\nFood query: ' + foodQuery }] }],
            generationConfig: { maxOutputTokens: 80, temperature: 0.1 }
          })
        }
      );
      if (geminiRes.ok) {
        const data = await geminiRes.json();
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const parsed = JSON.parse(rawText.replace(/```json/g, '').replace(/```/g, '').trim());
        if (typeof parsed.kcal === 'number') return res.status(200).json(parsed);
      }
    } catch (e) {
      console.warn('Gemini lookup failed:', e.message);
    }
  }

  return res.status(502).json({ error: 'AI food lookup unavailable. Please enter food details manually or verify API keys.' });
};
