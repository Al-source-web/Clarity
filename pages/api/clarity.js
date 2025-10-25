// pages/api/clarity.js
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

/* ----------------------------- clients ----------------------------- */
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

/* ------------------ history helpers (continuity + logging) ------------------ */
function toModelHistory(raw = []) {
  if (!Array.isArray(raw)) return [];
  const MAX_TURNS = 3;
  const TRIMMED = raw.slice(-MAX_TURNS).map(m => {
    const role = m?.role === "assistant" ? "assistant" : "user";
    let content = (m?.content || "").toString();
    if (content.length > 3000) content = content.slice(0, 3000) + "…";
    return { role, content };
  });
  return TRIMMED;
}

function makeRequestId() {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
}

/* -------------------- record normalization (no UI crashes) -------------------- */
function ensureArray(v) {
  if (Array.isArray(v)) return v;
  if (v === null || v === undefined || v === "") return [];
  return [v];
}

function normalizeRecord(record = {}) {
  return {
    id: record.id,
    name: record.name || "Unknown",
    verdict: record.verdict || "unknown",
    dao: record.dao_histamine_signal || "unspecified",
    cycle: record.cycle_flag || "unspecified",
    cycle_notes: record.cycle_notes || "unspecified",
    citations: ensureArray(record.citations),
    cross_reactivity: ensureArray(record.cross_reactivity),
    hormone_modulation_note: record.hormone_modulation_note || "unspecified",
    dao_mechanism: record.dao_mechanism || "unspecified",
    dao_notes: record.dao_notes || "unspecified",
    trust_signals: record.trust_signals || "weak",
    confidence: typeof record.confidence === "number" ? record.confidence : 0.0,
    source_type: record.source_type || "unspecified"
  };
}

/* ----------------------------- prompts ----------------------------- */
function buildSystemPrompt() {
  return `
You are Clarity, a maternal and infant ingredient safety companion.
Your role is to answer with empathy, continuity, and clarity.

Guidelines:
- Tone: warm, conversational, supportive. Empathetic when user is anxious. Evidence-based but human.
- Style: short paragraphs, natural flow (avoid rigid bullets). Small emoji anchors (💧 🤱 💤 ⚠️) sparingly.
- Continuity: build on what was said; ask 1–2 genuine follow-ups.
- If evidence is weak, say so and suggest safer swaps.
- Only advise consulting a provider when clearly warranted (not boilerplate).
- If an ingredient has cross-reactivity, fill "cross_reactivity" succinctly (e.g., "vitamin C cofactor", "calcium interferes with iron", "high histamine → DAO/mast cell sensitivity").
- No retailer links. You may allude to healthai.com/clarity/<slug>.

Return JSON only:
{
  "mode": "ingredient" | "wellness",
  "title": "string",
  "verdict": "Safe" | "Caution" | "Avoid" | null,
  "friendly": "string",
  "scientific": "string",
  "closing": "string",
  "followups": ["string","string"],
  "cross_reactivity": "string"
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
    ...toModelHistory(history),
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
      followups: ["Want me to suggest safer alternatives?", "Should we adjust this around your meds or sleep?"],
      cross_reactivity: ""
    };
  }
}

/* ------------------ logging to Supabase (non-blocking) ------------------ */
async function logInteraction({ request_id, user_query, history, kind, model_response, ui }) {
  try {
    await supabase.from("clarity_interactions").insert([
      {
        request_id,
        user_query,
        history: toModelHistory(history),
        kind,
        model_response,
        ui
      }
    ]);
  } catch (e) {
    console.error("logInteraction error:", e?.message || e);
  }
}

/* -------------------------- main handler --------------------------- */
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const request_id = makeRequestId();

  try {
    const { message, history, page } = req.body || {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Missing message in body" });
    }

    const baseFromUser = baseIngredientFromMessage(message);

    /* ----------------------- Optional pagination ----------------------- */
    const PAGE_SIZE = 20;
    const pageNum = Number.isInteger(page) && page > 0 ? page : null;
    const from = pageNum ? (pageNum - 1) * PAGE_SIZE : null;
    const to = pageNum ? (from + PAGE_SIZE - 1) : null;

    /* ----------------------- Supabase lookup ----------------------- */
    // Base (non-paginated) lookup for quick hit
    const baseQuery = supabase
      .from("ingredients_variants")
      .select(
        "id, name, verdict, dao_histamine_signal, cycle_flag, cycle_notes, citations, cross_reactivity, hormone_modulation_note, dao_mechanism, dao_notes, trust_signals, confidence, source_type"
      )
      .ilike("name", `%${message}%`)
      .limit(5);

    const { data: quick, error: quickError } = await baseQuery;
    if (quickError) console.error("Supabase quick error:", quickError);

    // Paginated (if requested)
    let paged = null, totalPlanned = null, pagedError = null;
    if (pageNum) {
      const pagedRes = await supabase
        .from("ingredients_variants")
        .select(
          "id, name, verdict, dao_histamine_signal, cycle_flag, cycle_notes, citations, cross_reactivity, hormone_modulation_note, dao_mechanism, dao_notes, trust_signals, confidence, source_type",
          { count: "planned" }
        )
        .ilike("name", `%${message}%`)
        .order("name", { ascending: true })
        .range(from, to);

      paged = pagedRes.data || null;
      totalPlanned = pagedRes.count ?? null;
      pagedError = pagedRes.error || null;
      if (pagedError) console.error("Supabase paginated error:", pagedError);
    }

    const dataset = (Array.isArray(paged) && paged.length) ? paged : quick;

    if (dataset && dataset.length) {
      const primary = normalizeRecord(dataset[0]);

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
          dao: primary.dao === "unspecified",
          cycle: primary.cycle === "unspecified"
        },
        engagement: buildEngagement(verdictNormalized, "ingredient"),
        followups: buildFollowups(base, verdictNormalized, "ingredient"),
        cross_reactivity: primary.cross_reactivity
      };

      if (pageNum) {
        ui.pagination = {
          current_page: pageNum,
          page_size: PAGE_SIZE,
          total_count: totalPlanned
        };
      }

      logInteraction({
        request_id,
        user_query: message,
        history,
        kind: "db",
        model_response: primary,
        ui
      });

      return res.status(200).json({ kind: "db", record: primary, ui });
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
      followups: buildFollowups(base, verdictNormalized, j.mode),
      cross_reactivity: j.cross_reactivity || ""
    };

    logInteraction({
      request_id,
      user_query: message,
      history,
      kind: "gpt",
      model_response: j,
      ui
    });

    return res.status(200).json({ kind: "gpt", answer, ui });

  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: "Server error", details: err.message, request_id });
  }
}
