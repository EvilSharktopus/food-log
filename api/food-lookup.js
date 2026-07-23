// Vercel serverless function — POST /api/food-lookup
// Returns: {"name":"...","kcal":number,"protein":number,"unknown":boolean}

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

  // Return clear error if no keys are configured at all
  if (!anthropicKey && !geminiKey) {
    return res.status(500).json({
      error: 'No API key configured. Add ANTHROPIC_API_KEY or GEMINI_KEY in Vercel → Settings → Environment Variables, then redeploy.'
    });
  }

  const systemInstruction = `You are a nutrition database. Return ONLY a raw JSON object — no markdown, no explanation, no extra text.

Schema:
{"name":"short item name","kcal":number,"protein":number,"unknown":false}

Rules:
- Set "unknown":true if you are genuinely unsure (home cooking, vague descriptions, made-up foods). Still provide your best numeric estimate.
- Set "unknown":false for named packaged foods, restaurant items, or common whole foods where you have reasonable data.
- "kcal" and "protein" are always numbers (never null).
- Keep "name" under 40 characters.`;

  // Try Claude first
  if (anthropicKey) {
    let claudeStatus = null;
    try {
      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-20241022',
          max_tokens: 80,
          system: systemInstruction,
          messages: [{ role: 'user', content: foodQuery }]
        })
      });

      claudeStatus = claudeRes.status;

      if (claudeRes.ok) {
        const data = await claudeRes.json();
        const rawText = data?.content?.[0]?.text || '';
        const parsed = JSON.parse(rawText.replace(/```json/g, '').replace(/```/g, '').trim());
        if (typeof parsed.kcal === 'number') return res.status(200).json(parsed);
        throw new Error('Claude returned invalid JSON structure');
      } else {
        const errText = await claudeRes.text().catch(() => '');
        console.warn(`Claude API returned ${claudeRes.status}:`, errText.slice(0, 200));
      }
    } catch (e) {
      console.warn('Claude lookup failed:', e.message);
      // If only Claude key configured and it failed, return specific error
      if (!geminiKey) {
        return res.status(502).json({
          error: `Claude API failed (HTTP ${claudeStatus || 'network error'}). Check your ANTHROPIC_API_KEY is valid and has credits.`
        });
      }
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
            generationConfig: { maxOutputTokens: 800, temperature: 0.1 }
          })
        }
      );

      if (geminiRes.ok) {
        const data = await geminiRes.json();

        // Gemini 2.5 Flash is a thinking model — response has multiple parts.
        // Find the non-thought part that contains the JSON answer.
        const parts = data?.candidates?.[0]?.content?.parts || [];
        const textPart = parts.find(p => !p.thought && typeof p.text === 'string' && p.text.trim().length > 0);
        const rawText = textPart?.text || '';

        if (!rawText) {
          console.warn('Gemini returned no usable text part. Full response:', JSON.stringify(data).slice(0, 500));
          return res.status(502).json({ error: 'Gemini returned an empty response. Try rephrasing your food query.' });
        }

        const parsed = JSON.parse(rawText.replace(/```json/g, '').replace(/```/g, '').trim());
        if (typeof parsed.kcal === 'number') return res.status(200).json(parsed);
        throw new Error('Gemini returned invalid JSON structure');
      } else {
        const errText = await geminiRes.text().catch(() => '');
        console.warn(`Gemini API returned ${geminiRes.status}:`, errText.slice(0, 200));
        return res.status(502).json({
          error: `Gemini API failed (HTTP ${geminiRes.status}). Check your GEMINI_KEY is valid.`
        });
      }
    } catch (e) {
      console.warn('Gemini lookup failed:', e.message);
      return res.status(502).json({
        error: `Gemini API error: ${e.message}`
      });
    }
  }

  return res.status(502).json({ error: 'AI food lookup unavailable. Please enter food details manually or verify API keys.' });
};
