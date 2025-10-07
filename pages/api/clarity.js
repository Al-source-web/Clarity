import fetch from 'node-fetch';
export default async function handler(req, res) {
  // Allow CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message, mode = 'best_friend' } = req.body || {};
    if (!message) {
      return res.status(400).json({ error: 'Missing message' });
    }

    const system = buildSystemPrompt(mode);
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
    }

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: message },
        ],
        temperature: 0.4,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return res.status(500).json({ error: 'OpenAI error', detail: text });
    }

    const data = await resp.json();
    const answer = data.choices?.[0]?.message?.content || '';
    return res.status(200).json({ answer });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}

function buildSystemPrompt(mode) {
  const base = `You are Clarity, an ingredient safety assistant for maternal, infant, and breastfeeding contexts.
- Priorities: accuracy, cautions, and safer alternatives.
- Coverage: lactation safety, infant/toddler safety, allergy/histamine risk, and contraindications.
- NEVER include shopping links or brand recommendations.
- If evidence is limited, say so and suggest a cautious path.
- Structure: summary + bullet risks/notes + next steps.
`;

  const bestFriend = `Tone: warm, reassuring, clear, short sentences.`;
  const scientific = `Tone: clinical, evidence-weighted, concise, mechanisms or references in-text (no links).`;

  return base + (mode === 'scientific' ? scientific : bestFriend);
}
