import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { message } = req.body;
  if (!message) return res.status(400).json({ error: "Missing input" });

  try {
    // Step 1: check supabase
    const { data } = await supabase
      .from("ingredients_variants")
      .select("name, verdict, dao_histamine_signal, cycle_notes, citations")
      .ilike("name", `%${message}%`)
      .limit(1);

    if (data && data.length > 0) {
      const entry = data[0];
      return res.json({
        answer: `Here’s what I found for *${entry.name}*:\n\nVerdict: ${entry.verdict}\nDAO/Histamine: ${entry.dao_histamine_signal || "n/a"}\nCycle notes: ${entry.cycle_notes || "n/a"}\n\nSources: ${(entry.citations && entry.citations.length) ? entry.citations.join(", ") : "none"}`
      });
    }

    // Step 2: fallback to GPT
    const gpt = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are Clarity, a helpful and empathetic assistant for ingredient safety and hormonal health. Always be supportive, clear, and a little engaging for tired parents." },
        { role: "user", content: message }
      ],
    });

    const answer = gpt.choices[0].message.content;
    res.json({ answer });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
}
