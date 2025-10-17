import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  // ---- CORS (Squarespace safe)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  // ---- Normalize incoming body
  let message;
  try {
    if (typeof req.body === "string") {
      const parsed = JSON.parse(req.body);
      message = parsed.message || parsed;
    } else if (typeof req.body === "object" && req.body !== null) {
      message = req.body.message;
    }
  } catch (err) {
    console.error("❌ JSON parse error:", req.body);
  }

  if (!message || typeof message !== "string") {
    return res
      .status(400)
      .json({ error: "Missing or invalid 'message' field" });
  }

  // ---- 1. Check Supabase
  let dbAnswer = null;
  try {
    const { data } = await supabase
      .from("ingredients_variants")
      .select("name, verdict, dao_histamine_signal, citations")
      .ilike("name", `%${message}%`)
      .limit(1);

    if (data && data.length > 0) {
      const item = data[0];
      dbAnswer = `Ingredient: ${item.name}\nVerdict: ${item.verdict}\nHistamine/DAO: ${item.dao_histamine_signal}\nCitations: ${item.citations || "N/A"}`;
    }
  } catch (err) {
    console.error("Supabase error:", err);
  }

  // ---- 2. Fallback to GPT if nothing in DB
  let finalAnswer = dbAnswer;
  if (!dbAnswer) {
    try {
      const completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are Clarity, an ingredient safety assistant for maternal, infant, and breastfeeding health. Always be clear, concise, and empathetic.",
          },
          { role: "user", content: message },
        ],
      });
      finalAnswer = completion.choices[0].message.content;
    } catch (err) {
      console.error("OpenAI error:", err);
      return res.status(500).json({ error: "AI lookup failed" });
    }
  }

  res.status(200).json({ answer: finalAnswer || "No response available." });
}
