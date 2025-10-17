// /pages/api/clarity.js
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  // CORS
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

    // 1) Supabase first
    const { data, error } = await supabase
      .from("ingredients_variants")
      .select("name, verdict, dao_histamine_signal, cycle_flag, cycle_notes, citations")
      .ilike("name", `%${message}%`)
      .limit(1);

    if (error) console.error("Supabase error:", error);

    if (data && data.length) {
      const row = data[0];
      // Normalize shapes for the widget
      const record = {
        name: row.name,
        verdict: row.verdict,                                         // "safe" | "caution" | "avoid"
        dao: row.dao_histamine_signal || "Unknown",                    // "Yes" | "No" | "Maybe" | "Unknown"
        cycle: row.cycle_flag || "N/A",
        cycle_notes: row.cycle_notes || "",
        citations: Array.isArray(row.citations) ? row.citations : (row.citations ? [row.citations] : [])
      };
      return res.status(200).json({ kind: "db", record });
    }

    // 2) GPT fallback (tone + coaching)
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are Clarity, an ingredient-safety assistant for maternal/infant/breastfeeding health. Friendly, concise, reassuring. If evidence is weak, say so and suggest safer swaps."
        },
        { role: "user", content: message }
      ],
    });

    const answer = completion.choices?.[0]?.message?.content?.trim() || "I don’t have a great answer yet.";
    return res.status(200).json({ kind: "gpt", answer });
  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: "Server error", details: err.message });
  }
}
