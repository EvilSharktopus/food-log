// Vercel serverless function — POST /api/food-lookup
// Parses natural food queries into structured JSON: {"name": "short name", "kcal": number, "protein": number}

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

  const systemInstruction = `You are a nutrition database. The user provides a food item or query. 
Return ONLY a valid, raw JSON object (no markdown, no backticks, no explanatory text) with this exact schema:
{"name":"short concise item name","kcal":number,"protein":number}`;

  // Try Claude API if key exists
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
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 250,
          system: systemInstruction,
          messages: [{ role: 'user', content: foodQuery }]
        })
      });

      if (claudeRes.ok) {
        const data = await claudeRes.json();
        const rawText = data?.content?.[0]?.text || '';
        const cleanJsonStr = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleanJsonStr);
        return res.status(200).json(parsed);
      }
    } catch (e) {
      console.warn('Claude API failed, falling back if possible:', e.message);
    }
  }

  // Fallback to Gemini API if key exists
  if (geminiKey) {
    try {
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: systemInstruction + '\nUser query: ' + foodQuery }] }]
          })
        }
      );
      if (geminiRes.ok) {
        const data = await geminiRes.json();
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const cleanJsonStr = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleanJsonStr);
        return res.status(200).json(parsed);
      }
    } catch (e) {
      console.warn('Gemini API fallback failed:', e.message);
    }
  }

  return res.status(502).json({ error: 'AI food lookup unavailable. Please enter food details manually or verify API keys.' });
};
