import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

/* ----------------------------- helpers ----------------------------- */
function slugifyForClarityPath(s = "") {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function normalizeVerdict(v = "") {
  const t = (v || "").toLowerCase();
  if (!t) return null;
  if (t.includes("avoid") || t.includes("not safe") || t.includes("not recommended") || t.includes("discouraged") || t.includes("harmful")) return "Avoid";
  if (t.includes("safe") || t.includes("generally safe")) return "Safe";
  return "Caution";
}

function buildEngagement(verdictNormalized, mode) {
  if (mode === "wellness") {
    return "🤝 Want ideas tailored to your routine, meds, or sleep? Ask for specifics!";
  }
  if (verdictNormalized === "Avoid") return "⚠️ Curious why it’s risky and what to try instead? Ask away!";
  if (verdictNormalized === "Safe")  return "💡 Want to know about dosage, timing, or long-term use? Try asking!";
  return "🤔 Want safer alternatives or usage limits? Ask for more details!";
}

function looksLikeIngredientQuery(message = "") {
  const oneWord = message.trim().split(/\s+/).length === 1;
  return (
    oneWord ||
    /(ingredient|supplement|vitamin|herb|powder|extract|capsule|tea|food|safe|avoid)/i.test(message)
  );
}

/* ---------- System + User prompts for consistent GPT fallback ------ */
function buildSystemPrompt() {
  return `
You are Clarity, a maternal and infant ingredient risk assistant.
Your job is to evaluate supplement and food ingredients for breastfeeding safety, histamine triggers, and usage guidance.

Tone + format:
- Switch tone: warm/supportive if user seems anxious; precise/evidence-based if they want details.
- Prefer short paragraphs with line breaks; avoid numbered lists unless user explicitly asks.
- You may use a few emoji anchors (💧 hydration, 🤱 nursing, 💤 rest) but do not mix numbers with emoji.
- If evidence is weak, say so and suggest safer swaps.
- Always include 1–2 empathetic, context-aware follow-up questions (not generic). Ask gently if they take medications/supplements to flag interactions.
- No retailer links. If an ingredient is mentioned, you may allude to an article at healthai.com/clarity/<slug>.

Return ONLY strict JSON matching this schema (no prose), keys exactly as written:

{
  "mode": "ingredient" | "wellness",
  "title": "string",                       // short topic/ingredient name
  "verdict": "Safe" | "Caution" | "Avoid" | null,
  "friendly": "string",                    // warm, short paragraphs, no numbered lists
  "scientific": "string",                  // brief, specific, evidence-aware
  "closing": "string",                     // one compassionate closing line
  "followups": ["string", "string"]        // 1-3 specific, empathetic follow-up questions
}
`.trim();
}

function buildUserPrompt(message) {
  return `User question: ${message}
Rules:
- If wellness/symptom, set "mode" to "wellness" and "verdict": null.
- If ingredient safety, set "mode" to "ingredient" and include a clear "verdict".
- Keep paragraphs short; avoid markdown headings and numbered lists.`;
}

/* ------------------ GPT call with JSON enforcement ------------------ */
async function callGPTJSON(message) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.6,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserPrompt(message) }
    ],
    response_format: { type: "json_object" }
  });

  const raw = completion.choices?.[0]?.message?.content ?? "";
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // As a last resort, return a minimal structure
    parsed = {
      mode: looksLikeIngredientQuery(message) ? "ingredient" : "wellness",
      title: message.trim().slice(0, 60) || "Guidance",
      verdict: null,
      friendly: "I don’t have a perfect answer yet, but I can help think it through with you.",
      scientific: "",
      closing: "You’re doing a lot — I’m here to help make this easier.",
      followups: ["Would you like me to suggest a safer alternative?", "Should we tailor this to your routine or meds?"]
    };
  }
  return parsed;
}

/* -------------------------- main handler --------------------------- */
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

    /* ----------------------- Supabase lookup ----------------------- */
    const { data, error } = await supabase
      .from("ingredients_variants")
      .select("name, verdict, dao_histamine_signal, cycle_flag, cycle_notes, citations")
      .ilike("name", `%${message}%`)
      .limit(5);

    if (error) console.error("Supabase error:", error);

    if (data && data.length) {
      const primary = data[0];
      const others = data.slice(1).map(r => r.name);

      const dao = primary.dao_histamine_signal || "Unknown";
      const cycle = primary.cycle_flag || "N/A";

      const record = {
        name: primary.name,
        verdict: primary.verdict,
        dao,
        cycle,
        cycle_notes: primary.cycle_notes || "",
        citations: Array.isArray(primary.citations)
          ? primary.citations
          : (primary.citations ? [primary.citations] : []),
        disambig: others
      };

      // UI metadata for consistent rendering across UIs
      const verdictNormalized = normalizeVerdict(primary.verdict);
      const ui = {
        mode: "ingredient",
        verdict_normalized: verdictNormalized,         // "Safe" | "Caution" | "Avoid" | null
        show_chip: Boolean(verdictNormalized),
        hide_fields: {
          dao: dao === "Unknown",
          cycle: cycle === "N/A"
        },
        engagement: buildEngagement(verdictNormalized, "ingredient"),
        followups: [
          "Would you like usage limits or safer alternatives?",
          "Are you taking any meds or supplements I should consider?"
        ]
      };

      return res.status(200).json({ kind: "db", record, ui });
    }

    /* ------------------------- GPT fallback ------------------------ */
    const j = await callGPTJSON(message);

    // Build simple, mobile-friendly combined text (for legacy front-ends)
    const friendly = j.friendly?.trim() || "";
    const scientific = j.scientific?.trim() ? `\n\n${j.scientific.trim()}` : "";
    const closing = j.closing?.trim() ? `\n\n${j.closing.trim()}` : "";
    const followupsTxt = (Array.isArray(j.followups) && j.followups.length)
      ? `\n\n• ${j.followups.join("\n• ")}`
      : "";

    let answer = `${j.title}\n\n${friendly}${scientific}${closing}${followupsTxt}`.trim();

    // Soft internal link hint for ingredients
    if (j.mode === "ingredient" && looksLikeIngredientQuery(message)) {
      const slug = slugifyForClarityPath(j.title || message);
      if (slug) {
        answer += `\n\n_(More on this soon at https://healthai.com/clarity/${slug}.)_`;
      }
    }

    const ui = {
      mode: j.mode === "ingredient" ? "ingredient" : "wellness",
      verdict_normalized: j.verdict || null,
      show_chip: j.mode === "ingredient" && Boolean(j.verdict),
      hide_fields: { dao: true, cycle: true }, // GPT path usually has no DAO/cycle
      engagement: buildEngagement(j.verdict || null, j.mode),
      followups: Array.isArray(j.followups) ? j.followups.slice(0, 3) : []
    };

    return res.status(200).json({ kind: "gpt", answer, ui });

  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: "Server error", details: err.message });
  }
}
