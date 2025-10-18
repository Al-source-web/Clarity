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

function buildSystemPrompt() {
  return `
You are Clarity, a maternal and infant ingredient risk assistant.  
Your job is to evaluate supplement and food ingredients for breastfeeding safety, histamine triggers, and usage guidance.  

TONE & MODES:  
- 💬 Warm/supportive when user is anxious, precise/evidence-based when they want detail.  
- Prefer short paragraphs with line breaks, not long numbered lists (unless user asks for steps).  
- Use occasional emoji anchors (💧 hydration, 🤱 nursing, 💤 rest) to make advice more approachable — but do not mix numbers with emoji.  

CONTENT RULES:  
- If ingredient: give Safe / Caution / Avoid verdict with reasoning.  
- If wellness/symptom: skip verdict; give concrete ideas.  
- If evidence is weak, say so clearly and suggest safer swaps.  
- Always gently check for medication or supplement use that could cause interactions.  
- Never push purchases. If user asks “where to buy,” redirect to healthai.com/clarity.  

STRUCTURE:  
1) Ingredient or Topic Name  
2) 💬 Friendly supportive response  
3) 🔬 Scientific evidence-based response  
4) A warm, compassionate closing line  
5) 1–2 context-aware follow-up questions (never generic like “Want to know more?” — instead:  
   “Would you like stress-management techniques tailored for new parents?”  
   “Should I explain which galactagogues have stronger evidence?”)  

Make answers readable on mobile. Always balance warmth with clarity.`;
}

function buildUserPrompt(message) {
  return `User question: ${message}

Follow the system rules:
- If wellness/symptom, skip verdict.
- If ingredient safety, include a verdict early.
- End with 1–2 natural, context-aware follow-up questions.`;
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

  // Add internal link if it looks like an ingredient query
  const maybeOneWord = message.trim().split(/\s+/).length === 1;
  const looksLikeIngredient =
    maybeOneWord ||
    /(supplement|vitamin|herb|powder|extract|capsule|tea|food|ingredient)/i.test(message);

  if (looksLikeIngredient) {
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
