// /pages/api/clarity.js

import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

// --- OpenAI client ---
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// --- Supabase client (server-side safe: anon key is fine here) ---
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  // --- CORS for Squarespace ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // --- Normalize incoming body to { message: string } ---
  let message = null;
  try {
    if (typeof req.body === "string") {
      const parsed = JSON.parse(req.body);
      message = typeof parsed === "string" ? parsed : parsed?.message;
    } else if (req.body && typeof req.body === "object") {
      message = req.body.message;
    }
  } catch {
    // fall through; message stays null
  }
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Missing message in body" });
  }

  try {
    // --- 1) Try Supabase first ---
    const { data, error } = await supabase
      .from("ingredients_variants")
      .select("name, verdict, dao_histamine_signal, cycle_flag, cycle_notes, citations")
      .ilike("name", `%${message}%`)
      .limit(1);

    if (error) {
      console.error("Supabase error:", error);
    }

    if (data && data.length > 0) {
      const r = data[0];
      return res.status(200).json({
        source: "supabase",
        record: {
          name: r.name,
          verdict: r.verdict,
          dao: r.dao_histamine_signal || "N/A",
          cycle: r.cycle_flag || "N/A",
          cycle_notes: r.cycle_notes || "",
          citations: Array.isArray(r.citations) ? r.citations : [],
        },
        // Keep text answer for simple renderers:
        answer: `Ingredient: ${r.name}
Verdict: ${r.verdict}
DAO/Histamine: ${r.dao_histamine_signal || "N/A"}
Cycle: ${r.cycle_flag || "N/A"} (${r.cycle_notes || ""})
Citations: ${
          r.citations && r.citations.length ? r.citations.join(", ") : "None"
        }`,
      });
    }

    // --- 2) GPT fallback (tone + guidance) ---
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are Clarity, an ingredient safety assistant for maternal, infant, and breastfeeding health. Be warm, clear, and parent-friendly. If uncertain, say so briefly and suggest next steps.",
        },
        { role: "user", content: message },
      ],
    });

    const answer = completion.choices?.[0]?.message?.content?.trim() || "No response.";
    return res.status(200).json({ source: "openai", answer });
  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: "Server error", details: err.message });
  }
}
