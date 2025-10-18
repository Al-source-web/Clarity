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

// NEW: mirror frontend’s “base ingredient” extractor
function baseIngredientFromMessage(q = "") {
  if (!q) return "";
  const first = q.split(/[-—:]/)[0].trim();
  const words = first.split(/\s+/).filter(Boolean);
  return words.length <= 3 ? first : words.slice(0, 3).join(" ");
}

function normalizeVerdict(v = "") {
  const t = (v || "").toLowerCase();
  if (!t) return null;
  if (
    t.includes("avoid") ||
    t.includes("not safe") ||
    t.includes("not recommended") ||
    t.includes("discouraged") ||
    t.includes("harmful")
  ) return "Avoid";
  if (t.includes("safe") || t.includes("generally safe")) return "Safe";
  return "Caution";
}

function looksLikeIngredientQuery(message = "") {
  const oneWord = message.trim().split(/\s+/).length === 1;
  return (
    oneWord ||
    /(ingredient|supplement|vitamin|herb|powder|extract|capsule|tea|food|safe|avoid|caution)/i.test(message)
  );
}

function buildEngagement(verdictNormalized, mode) {
  if (mode === "wellness") {
    return "🤝 Want ideas tailored to your routine, meds, or sleep? Ask for specifics!";
  }
  if (verdictNormalized === "Avoid") return "⚠️ Curious why it’s risky and what to try instead? Ask away!";
  if (verdictNormalized === "Safe")  return "💡 Want to know about dosage, timing, or long-term use? Try asking!";
  return "🤔 Want safer alternatives or usage limits? Ask for more details!";
}

// NEW: context-aware follow-ups (same spirit as frontend)
const HARM_SET = new Set(["tobacco","nicotine","alcohol","ethanol","cannabis","weed","marijuana","vape","vaping"]);
function buildFollowups(base = "", verdict = null, mode = "ingredient") {
  const b = (base || "").toLowerCase().trim();
  const v = (verdict || "").toLowerCase();

  if (mode === "wellness") {
    return [
      "Want practical ideas that fit your routine and sleep?",
      "Should we tailor options around any meds or supplements you’re taking?"
    ];
  }

  // Ingredient path
  if (HARM_SET.has(b) || v.includes("avoid") || v.includes("not safe")) {
    return [
      "Safer alternatives or usage limits",
      "Ways to reduce exposure / quitting supports",
      "Why it’s risky + what to try instead"
    ];
  }
  if (v.includes("safe")) {
    return [
      "Dosage, timing, or long-term use",
      "Quick hydration + snack ideas that really help",
      "Possible interactions with meds/supplements"
    ];
  }
  // Caution / unsure
  return [
    "Safer alternatives or usage limits",
    "Foods that may support supply",
    "Stress-management tips tailored for new parents"
  ];
}

/* ---------- System + User prompts for consistent GPT fallback ------ */
function buildSystemPrompt() {
  return `
You are Clarity, a maternal and infant ingredient risk assistant.
Your job is to evaluate supplement and food ingredients for breastfeeding safety, histamine triggers, and usage guidance.

Tone + format:
- Switch tone: warm/supportive if user seems anxious; precise/evidence-based if they want details.
- Prefer short paragraphs with line breaks; avoid numbered lists unless user explicitly asks.
- Use small emoji anchors sparingly (💧 🤱 💤); do not mix numbers with emoji.
- If evidence is weak, say so and suggest safer swaps.
- Always include 1–2 empathetic, context-aware follow-up questions (not generic). Ask gently if they take medications/supplements to flag interactions.
- No retailer links. If an ingredient is mentioned, you may allude to an article at healthai.com/clarity/<slug>.

Return ONLY strict JSON matching this schema (no prose), keys exactly as written:
{
  "mode": "ingredient" | "wellness",
  "title": "string",
  "verdict": "Safe" | "Caution" | "Avoid" | null,
  "friendly": "string",
  "scientific": "string",
  "closing": "string",
  "followups": ["string","string"]
}
`.trim();
}

function buildUserPrompt(message) {
  return `User question: ${message}
Rules:
- If wellness/symptom, set "mode" to "wellness" and "verdict": null.
- If ingredient safety, set "mode" to "ingredient" and include a clear "verdict".
- Keep paragraphs short; avoid markdown headings and numbered lists.`.trim();
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
    parsed = {
      mode: looksLikeIngredientQuery(message) ? "ingredient" : "wellness",
      title: message.trim().slice(0, 60) || "Guidance",
      verdict: null,
      friendly: "I don’t have a perfect answer yet, but I can help think it through with you.",
      scientific: "",
      closing: "You’re doing a lot — I’m here to help make this easier.",
      followups: [
        "Would you like usage limits or safer alternatives?",
        "Should we tailor this to your routine or meds?"
      ]
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

    const baseFromUser = baseIngredientFromMessage(message);
    const looksIngredient = looksLikeIngredientQuery(message);

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
      const base = primary.name || baseFromUser;
      const article_url = primary.name ? `https://healthai.com/clarity/${slugifyForClarityPath(primary.name)}` : null;

      const ui = {
        mode: "ingredient",
        header: "Ingredient Check",
        base,
        article_url,
        verdict_normalized: verdictNormalized,   // "Safe" | "Caution" | "Avoid" | null
        show_chip: Boolean(verdictNormalized),   // ensure chip displays for DB path
        hide_fields: {
          dao: dao === "Unknown",
          cycle: cycle === "N/A"
        },
        engagement: buildEngagement(verdictNormalized, "ingredient"),
        followups: buildFollowups(base, verdictNormalized, "ingredient")
      };

      return res.status(200).json({ kind: "db", record, ui });
    }

    /* ------------------------- GPT fallback ------------------------ */
    const j = await callGPTJSON(message);

    const friendly = j.friendly?.trim() || "";
    const scientific = j.scientific?.trim() ? `\n\n${j.scientific.trim()}` : "";
    const closing = j.closing?.trim() ? `\n\n${j.closing.trim()}` : "";
    const followupsTxt = (Array.isArray(j.followups) && j.followups.length)
      ? `\n\n• ${j.followups.join("\n• ")}`
      : "";
    let answer = `${j.title}\n\n${friendly}${scientific}${closing}${followupsTxt}`.trim();

    let article_url = null;
    if (j.mode === "ingredient" && looksIngredient) {
      const slug = slugifyForClarityPath(j.title || message);
      if (slug) {
        article_url = `https://healthai.com/clarity/${slug}`;
        answer += `\n\n_(More on this soon at ${article_url}.)_`;
      }
    }

    const verdictNormalized = j.mode === "ingredient" ? normalizeVerdict(j.verdict) : null;
    const base = j.mode === "ingredient" ? baseIngredientFromMessage(j.title || message) : baseFromUser;

    const ui = {
      mode: j.mode === "ingredient" ? "ingredient" : "wellness",
      header: j.mode === "ingredient" ? "Ingredient Check" : "Wellness Guidance",
      base,
      article_url,
      verdict_normalized: verdictNormalized,
      show_chip: j.mode === "ingredient" && Boolean(verdictNormalized),
      hide_fields: { dao: true, cycle: true }, // GPT path usually has no DAO/cycle fields
      engagement: buildEngagement(verdictNormalized, j.mode),
      followups: buildFollowups(base, verdictNormalized, j.mode)
    };

    return res.status(200).json({ kind: "gpt", answer, ui });

  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: "Server error", details: err.message });
  }
}
