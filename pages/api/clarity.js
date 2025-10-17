import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  // CORS for Squarespace
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { q } = req.body;
  if (!q) return res.status(400).json({ error: "Missing query" });

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };
  const encoded = encodeURIComponent(`%${q}%`);

  // --- 1) Try Supabase match ---
  let response = await fetch(
    `${supabaseUrl}/rest/v1/ingredients_variants?select=*&name=ilike.${encoded}&limit=5`,
    { headers }
  );
  let rows = await response.json();

  if (!rows?.length) {
    response = await fetch(
      `${supabaseUrl}/rest/v1/ingredients_variants?select=*&group_root=ilike.${encoded}&limit=5`,
      { headers }
    );
    rows = await response.json();
  }

  if (rows && rows.length) {
    const best = rows[0];
    return res.status(200).json({
      source: "supabase",
      query: q,
      result: {
        name: best.name,
        verdict: best.verdict,
        why_brief: best.why_brief,
        mechanism: best.mechanism,
        swaps: [best.swap1, best.swap2].filter(Boolean),
        dao: {
          signal: best.dao_histamine_signal,
          mechanism: best.dao_mechanism,
          notes: best.dao_notes,
          evidence: best.dao_evidence,
          class: best.dao_class,
        },
        cycle: {
          flag: best.cycle_flag,
          notes: best.cycle_notes,
        },
        citations: best.citations || [],
      },
    });
  }

  // --- 2) Fall back to GPT personality ---
  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini", // or your custom GPT model
      messages: [
        {
          role: "system",
          content:
            "You are Clarity, an ingredient safety assistant for maternal, infant, and breastfeeding contexts. Be warm, concise, and supportive.",
        },
        { role: "user", content: q },
      ],
    });

    return res.status(200).json({
      source: "gpt",
      query: q,
      answer: completion.choices[0].message.content,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "AI fallback failed" });
  }
}
