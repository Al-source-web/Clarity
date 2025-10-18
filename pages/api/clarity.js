import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

/* ------------------ Helpers ------------------ */
function slugifyForClarityPath(s = "") {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

// UI chip for verdicts
function verdictChip(verdict = "") {
  const v = verdict.toLowerCase();
  if (/(avoid|not safe|discouraged|harmful)/.test(v)) {
    return `<span style="display:inline-flex;align-items:center;gap:6px;background:#ffefef;color:#b42318;border:1px solid #f5b5b1;border-radius:999px;padding:2px 8px;font-size:13px;font-weight:700;">🔴 Avoid</span>`;
  }
  if (/(safe|generally safe)/.test(v)) {
    return `<span style="display:inline-flex;align-items:center;gap:6px;background:#e9f9f1;color:#146c43;border:1px solid #b7ebce;border-radius:999px;padding:2px 8px;font-size:13px;font-weight:700;">🟢 Safe</span>`;
  }
  return `<span style="display:inline-flex;align-items:center;gap:6px;background:#fff6e6;color:#9a6700;border:1px solid #ffdd99;border-radius:999px;padding:2px 8px;font-size:13px;font-weight:700;">🟡 Caution</span>`;
}

// very light ingredient heuristic so we can decide if a chip should show on GPT path
function looksLikeIngredientQuery(q = "") {
  const words = q.trim().split(/\s+/);
  const oneWord = words.length === 1;
  const hasFoodish =
    /(supplement|vitamin|herb|powder|extract|capsule|tea|food|ingredient|safe|avoid|caution)/i.test(
      q
    );
  return oneWord || hasFoodish;
}

/* ------------------ Prompts ------------------ */
function buildSystemPrompt() {
  return `
You are Clarity, a maternal & infant ingredient risk assistant.
Your job: evaluate supplement/food ingredients for breastfeeding safety, histamine triggers, and usage guidance.

TONE & STYLE
- Dynamically switch tone: warm/supportive if user seems anxious; precise/evidence-based when they ask for details.
- **Do not use numbered lists** unless the user *explicitly* asks for step-by-step. Prefer short paragraphs with natural line breaks and an occasional bold lead-in. You may use a few emoji anchors (💧, 🤱, 💤) but never mix numbers with emoji.
- If evidence is weak, say so and suggest safer swaps.
- End with 1–2 empathetic, context-aware follow-up questions (no generic “Want to learn more?”).
- Gently ask about medications/supplements if relevant (to check interactions).
- Never include retailer/buy links.

INGREDIENT VS. WELLNESS
- If the user asks about an ingredient’s safety, include a clear verdict: Safe / Caution / Avoid with a brief reason.
- If it’s a wellness/symptom topic (not one ingredient), **do not** give a verdict—offer concrete ideas instead.

INTERNAL LINKING
- When you clearly mention a single ingredient, add: https://healthai.com/clarity/<slug>
  If no article exists yet, say: “We’re working on an article for this ingredient — you’ll be able to find it soon at healthai.com/clarity.”

OUTPUT SHAPE (free text, but follow this order)
1) Short title: ingredient or topic
2) 💬 friendly paragraph(s)
3) 🔬 short scientific paragraph(s)
4) A warm one-line closing
5) 1–3 organic follow-up questions (no heading, just sentences)
`.trim();
}

function buildUserPrompt(message) {
  return `
User: ${message}

Rules to enforce right now:
- No numbered lists (unless user explicitly asked for step-by-step).
- Prefer warm short paragraphs, with line breaks and occasional bold lead-ins.
- If ingredient safety: include a verdict early (Safe/Caution/Avoid) with reason. If wellness topic: no verdict.
- End with 1–2 specific, empathetic follow-up questions.
`.trim();
}

async function callGPTFallback(message) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.7,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserPrompt(message) }
    ]
  });

  let text = completion.choices?.[0]?.message?.content?.trim() || "";

  // add internal link if it looks like a single ingredient
  if (looksLikeIngredientQuery(message)) {
    const slug = slugifyForClarityPath(message);
    if (!/healthai\.com\/clarity\//i.test(text)) {
      text += `\n\n_(More on this soon at https://healthai.com/clarity/${slug}.)_`;
    }
  }

  // light verdict inference for UI chip on the GPT path (only when it looks like ingredient)
  let gptVerdict = null;
  if (looksLikeIngredientQuery(message)) {
    const L = text.toLowerCase();
    if (/(avoid|not safe|discouraged|harmful)/.test(L)) gptVerdict = "Avoid";
    else if (/generally safe|safe\b/.test(L)) gptVerdict = "Safe";
    else gptVerdict = "Caution";
  }

  return { text, verdict: gptVerdict };
}

/* ------------------ Handler ------------------ */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { message } = req.body || {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Missing message in body" });
    }

    // 1) Supabase lookup
    const { data, error } = await supabase
      .from("ingredients_variants")
      .select("name, verdict, dao_histamine_signal, cycle_flag, cycle_notes, citations")
      .ilike("name", `%${message}%`)
      .limit(5);

    if (error) console.error("Supabase error:", error);

    if (data && data.length) {
      const primary = data[0];
      const others = data.slice(1).map(r => r.name);

      const record = {
        name: primary.name,
        verdict: primary.verdict,
        dao: primary.dao_histamine_signal || "Unknown",
        cycle: primary.cycle_flag || "N/A",
        cycle_notes: primary.cycle_notes || "",
        citations: Array.isArray(primary.citations)
          ? primary.citations
          : (primary.citations ? [primary.citations] : []),
        disambig: others
      };

      // include chip HTML for the front-end to drop in
      const chipHtml = verdictChip(primary.verdict);

      return res.status(200).json({
        kind: "db",
        record,
        ui: { chipHtml } // <— use this in your header
      });
    }

    // 2) GPT fallback
    const { text, verdict } = await callGPTFallback(message);
    return res.status(200).json({
      kind: "gpt",
      answer: text,
      meta: { verdict } // null for wellness; Safe/Caution/Avoid for ingredients
    });

  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: "Server error", details: err.message });
  }
}
