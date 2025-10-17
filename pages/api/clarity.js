// /pages/api/clarity.js

import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

// ====== CONFIG ======
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // Set in Vercel → Environment Variables
});

const supabase = createClient(
  process.env.SUPABASE_URL,      // e.g. https://xyzcompany.supabase.co
  process.env.SUPABASE_ANON_KEY  // anon key from Supabase project settings
);

// ====================

export default async function handler(req, res) {
  // CORS headers for Squarespace
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ---- Parse JSON body ----
  let body = {};
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch (e) {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  const message = body?.message?.trim();
  if (!message) {
    return res.status(400).json({ error: "Missing 'message' in request body" });
  }

  try {
    // ---- 1. Check Supabase DB first ----
    const { data, error } = await supabase
      .from("ingredients_variants")
      .select("name, verdict, dao_histamine_signal, citations")
      .ilike("name", `%${message}%`)
      .limit(1);

    if (error) {
      console.error("Supabase error:", error);
    }

    if (data && data.length > 0) {
      const item = data[0];
      return res.status(200).json({
        answer: `According to our database:\n\n**${item.name}** → Verdict: ${item.verdict}\nDAO Signal: ${item.dao_histamine_signal || "N/A"}\n\nCitations: ${
          item.citations?.length ? JSON.stringify(item.citations) : "none available"
        }`,
        source: "supabase",
      });
    }

    // ---- 2. If not found, fallback to GPT ----
    const gpt = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are Clarity, an ingredient safety assistant for maternal, infant, and breastfeeding health. Be warm, concise, and practical. Cite evidence where possible.",
        },
        { role: "user", content: message },
      ],
      max_tokens: 300,
    });

    const reply = gpt.choices[0]?.message?.content || "No response.";

    return res.status(200).json({
      answer: reply,
      source: "openai",
    });
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
