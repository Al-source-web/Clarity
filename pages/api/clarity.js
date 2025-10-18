import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// ------------------ Prompt helpers ------------------
function slugifyForClarityPath(s = "") {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

// verdict chip UI
function verdictChip(verdict) {
  const v = (verdict || "").toLowerCase();
  if (v.includes("avoid") || v.includes("not safe") || v.includes("harmful")) {
    return `<span style="display:inline-flex;align-items:center;gap:6px;
      background:#ffefef;color:#b42318;border:1px solid #f5b5b1;
      border-radius:999px;padding:2px 8px;font-size:13px;font-weight:700;">
      🔴 Avoid</span>`;
  }
  if (v.includes("safe") || v.includes("generally safe")) {
    return `<span style="display:inline-flex;align-items:center;gap:6px;
      background:#e9f9f1;color:#146c43;border:1px solid #b7ebce;
      border-radius:999px;padding:2px 8px;font-size:13px;font-weight:700;">
      🟢 Safe</span>`;
  }
  return `<span style="display:inline-flex;align-items:center;gap:6px;
    background:#fff6e6;color:#9a6700;border:1px solid #ffdd99;
    border-radius:999px;padding:2px 8px;font-size:13px;font-weight:700;">
    🟡 Caution</span>`;
}

function buildSystemPrompt() {
  return `
You are Clarity, a maternal and infant ingredient risk assistant. 
Your job is to evaluate supplement and food ingredients for breastfeeding safety, histamine triggers, and usage guidance. 

Tone should dynamically switch: warm/supportive when user is anxious, precise/evidence-based when they want details. 
Prefer warm short paragraphs with line breaks instead of numbered lists, unless the user explicitly asks for step-by-step instructions. 
Use occasional emoji anchors (💧 hydration, 🤱 nursing, 💤 rest) to make advice friendlier — but do not mix numbers with emoji. 
If evidence is weak, say so clearly and suggest safer swaps. 

At the end, include 1–2 empathetic follow-up questions that feel human (e.g. "Would you like stress-management techniques tailored for new parents?" or "Should I explain which galactagogues have stronger evidence?"). 
Always check gently if the user is taking medications or supplements to flag possible interactions. 
Avoid generic closings like "Want to know more?" — make follow-ups context-aware and specific.

OUTPUT FORMAT:
1) Ingredient or Topic Name
2) 💬 friendly response
3) 🔬 short scientific response
4) A warm compassionate closing line
5) 1–3 organic follow-up prompts/questions (no titles, just sentences)`;
}

function buildUserPrompt(message) {
  return `User question: ${message}

Follow the system rules:
- If wellness/symptom, skip verdict chips.
- If ingredient safety, include a verdict chip early.
- Remove markdown headings (###) and use plain bold or inline text.
- End with 1–3 natural, context-aware follow-up questions.`;
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

  // strip markdown headings like ### Something
  text = text.replace(/^###\s*/gm, "").replace(/^##\s*/gm, "").replace(/^#\s*/gm, "");

  // Decide if this looks like an ingredient query
  const maybeOneWord = message.trim().split(/\s+/).length === 1;
  const looksLikeIngredient =
    maybeOneWord ||
    /(supplement|vitamin|herb|powder|extract|capsule|tea|food|ingredient|safe|avoid|caution)/i.test(message);

  if (looksLikeIngredient) {
    // prepend verdict chip if GPT text includes Safe/Avoid/Caution
    let verdict = null;
    if (/avoid/i.test(text)) verdict = "Avoid";
    else if (/safe/i.test(text)) verdict = "Safe";
    else if (/caution/i.test(text)) verdict = "Caution";

    if (verdict) {
      text =
        `<div style="margin-bottom:8px;">${verdictChip(verdict)}</div>` +
        text;
    }

    // Add internal link
    const slug = slugifyForClarityPath(message);
    const url = `https://healthai.com/clarity/${slug}`;
    if (!text.includes("healthai.com/clarity/")) {
      text += `\n\n_(More on this soon at ${url}.)_`;
    }
  }

  return text;
}

// ------------------ Handler ------------------
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

    // Supabase lookup
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
      return res.status(200).json({ kind: "db", record });
    }

    // GPT fallback
    const answer = await callGPTFallback(message);
    return res.status(200).json({ kind: "gpt", answer });

  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: "Server error", details: err.message });
  }
}
