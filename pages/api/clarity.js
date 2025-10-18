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

function baseIngredientFromMessage(q = "") {
  if (!q) return "";
  const first = q.split(/[-—:]/)[0].trim();
  const words = first.split(/\s+/).filter(Boolean);
  return words.length <= 3 ? first : words.slice(0, 3).join(" ");
}

function normalizeVerdict(v = "") {
  const t = (v || "").toLowerCase();
  if (!t) return null;
  if (t.includes("avoid") || t.includes("not safe") || t.includes("discouraged") || t.includes("harmful")) return "Avoid";
  if (t.includes("safe") || t.includes("generally safe")) return "Safe";
  return "Caution";
}

function looksLikeIngredientQuery(message = "") {
  const oneWord = message.trim().split(/\s+/).length === 1;
  return oneWord || /(ingredient|supplement|vitamin|herb|powder|extract|capsule|tea|food|safe|avoid|caution)/i.test(message);
}

function buildEngagement(verdictNormalized, mode) {
  if (mode === "wellness") {
    return "🤝 Want ideas tailored to your routine, meds, or sleep? Ask for specifics!";
  }
  if (verdictNormalized === "Avoid") return "⚠️ Curious why it’s risky and what to try instead? Ask away!";
  if (verdictNormalized === "Safe")  return "💡 Want to know about dosage, timing, or long-term use? Try asking!";
  return "🤔 Want safer alternatives or usage limits? Ask for more details!";
}

const HARM_SET = new Set(["tobacco","nicotine","alcohol","ethanol","cannabis","weed","marijuana","vape","vaping"]);
function buildFollowups(base = "", verdict = null, mode = "ingredient") {
  const b = (base || "").toLowerCase().trim();
  const v = (verdict || "").toLowerCase();

  if (mode === "wellness") {
    return [
      "Want practical tips that fit your routine and sleep?",
      "Should we adjust advice around any meds or supplements you’re taking?"
    ];
  }
  if (HARM_SET.has(b) || v.includes("avoid")) {
    return [
      "Safer alternatives or usage limits",
      "Ways to reduce exposure or supports for quitting",
      "Why it’s risky + what to try instead"
    ];
  }
  if (v.includes("safe")) {
    return [
      "Dosage, timing, or long-term use",
      "Quick hydration + snack ideas that really help",
      "Possible interactions with medications or supplements"
    ];
  }
  return [
    "Safer alternatives or usage limits",
    "Foods that may support supply",
    "Stress-management tips tailored for new parents"
  ];
}

/* ---------- Prompts ---------- */
function buildSystemPrompt() {
  return `
You are Clarity, a maternal and infant ingredient safety companion.
Your role is to answer with empathy, continuity, and clarity.

Guidelines:
- Tone: warm, conversational, supportive. Empathetic when user is anxious. Evidence-based but human.
- Style: short paragraphs, natural flow, not rigid bullets. Insert small emoji anchors (💧 🤱 💤 ⚠️) to keep it warm.
- Continuity: always keep in mind what was just said; build follow-ups that flow naturally from conversation.
- If evidence is weak, say so and suggest safer swaps.
- Always add 1–2 context-aware follow-up questions (e.g., about meds, symptoms, goals). They should feel like invitations to continue, not generic.
- No retailer links. If an ingredient is mentioned, allude to healthai.com/clarity/<slug>.

Return JSON only:

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
- If wellness/symptom, set "mode":"wellness" and "verdict":null.
- If ingredient safety, set "mode":"ingredient" and include a clear verdict.
- Use empathetic tone, short paragraphs, emojis. No numbered lists.`.trim();
}

/* ------------------ GPT call with continuity ------------------ */
async function callGPTJSON(message, history = []) {
  const messages = [
    { role: "system", content: buildSystemPrompt() },
    ...history,
    { role: "user", content: buildUserPrompt(message) }
  ];

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.6,
    messages,
    response_format: { type: "json_object" }
  });

  const raw = completion.choices?.[0]?.message?.content ?? "";
  try {
    return JSON.parse(raw);
  } catch {
    return {
      mode: looksLikeIngredientQuery(message) ? "ingredient" : "wellness",
      title: message.trim().slice(0,60) || "Guidance",
      verdict: null,
      friendly: "I don’t have a perfect answer yet, but I can think it through with you 💭",
      scientific: "",
      closing: "You’re doing a lot — I’m here to help make this easier 💚",
      followups: ["Want me to suggest safer alternatives?", "Should we adjust this around your meds or sleep?"]
    };
  }
}

/* -------------------------- main handler --------------------------- */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { message, history } = req.body || {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Missing message in body" });
    }

    const baseFromUser = baseIngredientFromMessage(message);

    /* ----------------------- Supabase lookup ----------------------- */
    const { data } = await supabase
      .from("ingredients_variants")
      .select("name, verdict, dao_histamine_signal, cycle_flag, cycle_notes, citations")
      .ilike("name", `%${message}%`)
      .limit(5);

    if (data && data.length) {
      const primary = data[0];
      const dao = primary.dao_histamine_signal || "Unknown";
      const cycle = primary.cycle_flag || "N/A";

      const record = {
        name: primary.name,
        verdict: primary.verdict,
        dao,
        cycle,
        cycle_notes: primary.cycle_notes || "",
        citations: Array.isArray(primary.citations) ? primary.citations : (primary.citations ? [primary.citations] : [])
      };

      const verdictNormalized = normalizeVerdict(primary.verdict);
      const base = primary.name || baseFromUser;
      const article_url = primary.name ? `https://healthai.com/clarity/${slugifyForClarityPath(primary.name)}` : null;

      const ui = {
        mode: "ingredient",
        header: "Ingredient Check",
        base,
        article_url,
        verdict_normalized: verdictNormalized,
        show_chip: Boolean(verdictNormalized),
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
    const j = await callGPTJSON(message, history || []);

    const friendly = j.friendly?.trim() || "";
    const scientific = j.scientific?.trim() ? `\n\n${j.scientific.trim()}` : "";
    const closing = j.closing?.trim() ? `\n\n${j.closing.trim()}` : "";
    const answer = `${j.title}\n\n${friendly}${scientific}${closing}`.trim();

    const verdictNormalized = j.mode === "ingredient" ? normalizeVerdict(j.verdict) : null;
    const base = j.mode === "ingredient" ? baseIngredientFromMessage(j.title || message) : baseFromUser;
    const article_url = j.mode === "ingredient" ? `https://healthai.com/clarity/${slugifyForClarityPath(j.title||message)}` : null;

    const ui = {
      mode: j.mode,
      header: j.mode === "ingredient" ? "Ingredient Check" : "Wellness Guidance",
      base,
      article_url,
      verdict_normalized: verdictNormalized,
      show_chip: j.mode === "ingredient" && Boolean(verdictNormalized),
      hide_fields: { dao: true, cycle: true },
      engagement: buildEngagement(verdictNormalized, j.mode),
      followups: buildFollowups(base, verdictNormalized, j.mode)
    };

    return res.status(200).json({ kind: "gpt", answer, ui });

  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: "Server error", details: err.message });
  }
}
