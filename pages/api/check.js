export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const q = (req.body?.q || "").toString().trim();
  if (!q) {
    return res.status(400).json({ ok: false, error: "Missing query" });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  const headers = { apikey: key, Authorization: `Bearer ${key}` };

  const encoded = encodeURIComponent(`%${q}%`);

  // Try by name
  let response = await fetch(
    `${url}/rest/v1/ingredients_variants?select=*&name=ilike.${encoded}&limit=10`,
    { headers }
  );
  let rows = await response.json();

  // Fallback by group_root if no matches
  if (!rows?.length) {
    response = await fetch(
      `${url}/rest/v1/ingredients_variants?select=*&group_root=ilike.${encoded}&limit=10`,
      { headers }
    );
    rows = await response.json();
  }

  const best = rows?.[0] || null;

  return res.status(200).json({
    ok: true,
    query: q,
    result: best
      ? {
          name: best.name,
          verdict: best.verdict,
          why_brief: best.why_brief,
          dao: {
            signal: best.dao_histamine_signal,
            mechanism: best.dao_mechanism,
          },
          cycle: {
            flag: best.cycle_flag,
            notes: best.cycle_notes,
          },
          citations: best.citations || [],
        }
      : null,
  });
}
