// /pages/api/clarity.js

import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

// --- Setup OpenAI client ---
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// --- Setup Supabase client ---
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  // --- Handle CORS preflight ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
  const message = req.body.message;  // <-- explicitly pull it out
  if (!message) {
    return res.status(400).json({ error: "Missing message in body" });
  }

    // --- 1. Try Supabase first ---
    let dbAnswer = null;
    const { data, error } = await supabase
      .from("ingredients_variants")
      .select("name, verdict, dao_histamine_signal, cycle_flag, cycle_notes, citations")
      .ilike("name", `%${message}%`)
      .limit(1);

    if (error) {
      console.error("Supabase error:", error);
    }

    if (data && data.length > 0) {
      const row = data[0];
      dbAnswer = `Ingredient: ${row.name}
Verdict: ${row.verdict}
DAO/Histamine: ${row.dao_histamine_signal || "N/A"}
Cycle: ${row.cycle_flag || "N/A"} (${row.cycle_notes || ""})
Citations: ${row.citations && row.citations.length > 0 ? row.citations.join(", ") : "None"}`;
    }

    // --- 2. If no DB match, ask GPT ---
    let finalAnswer = dbAnswer;
    if (!finalAnswer) {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini", // fast + cheaper
        messages: [
          {
            role: "system",
            content:
              "You are Clarity, an ingredient safety assistant for maternal, infant, and breastfeeding health. Respond in a warm, clear, and parent-friendly tone. Be concise but reassuring.",
          },
          { role: "user", content: message },
        ],
      });

      finalAnswer = completion.choices[0].message.content.trim();
    }

    return res.status(200).json({ answer: finalAnswer });
  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: "Server error", details: err.message });
  }
}
