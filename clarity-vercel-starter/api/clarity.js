export default async function handler(req, res){
  // Basic CORS (adjust origin as needed)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if(req.method === 'OPTIONS'){ res.status(200).end(); return; }

  if(req.method !== 'POST'){
    res.status(405).json({error:'Method not allowed'}); return;
  }

  try{
    const { message, mode='best_friend' } = req.body || {};
    if(!message){ res.status(400).json({error:'Missing message'}); return; }

    const system = buildSystemPrompt(mode);

    const apiKey = process.env.OPENAI_API_KEY;
    if(!apiKey){ res.status(500).json({error:'Missing OPENAI_API_KEY'}); return; }

    // Use Chat Completions for wide compatibility
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Authorization':`Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role:'system', content: system },
          { role:'user', content: message }
        ],
        temperature: 0.4
      })
    });

    if(!resp.ok){
      const text = await resp.text();
      res.status(500).json({error:'OpenAI error', detail:text});
      return;
    }
    const data = await resp.json();
    const answer = data.choices?.[0]?.message?.content || '';

    res.status(200).json({answer});
  }catch(e){
    console.error(e);
    res.status(500).json({error:'Server error'});
  }
}

function buildSystemPrompt(mode){
  const base = `You are Clarity, an ingredient safety assistant for maternal, infant, and breastfeeding contexts.
- Priorities: accuracy, cautions, and options for safer alternatives.
- Coverage: lactation safety, infant/toddler safety, allergy/histamine risk (DAO inhibitors, mast-cell triggers), and general interactions/contraindications.
- NEVER include shopping or product links. Do not recommend brands.
- If evidence is limited, say so plainly and suggest a prudent path.
- Structure: concise summary, bullets for risks/notes, and simple next-steps.
`;
  const bestFriend = `Tone: warm, reassuring, clear. Plain language. Short sentences.`;
  const scientific = `Tone: clinical, evidence-weighted, concise. Include key mechanisms or references in-text (no links).`;

  return base + (mode==='scientific' ? scientific : bestFriend);
}
