import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // must be set in Vercel → Environment Variables
});

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Parse body safely
    const { message } = req.body || {};
    if (!message) {
      return res.status(400).json({ error: "Missing 'message' in request body" });
    }

    // Call your custom GPT
    const response = await client.chat.completions.create({
      model: "g-68e1d4cf8c248191a32369a47a035680", // ✅ your custom GPT ID
      messages: [
        {
          role: "system",
          content:
            "You are Clarity, an ingredient safety assistant for maternal, infant, and breastfeeding contexts.",
        },
        {
          role: "user",
          content: message,
        },
      ],
      temperature: 0.7,
      max_tokens: 500,
    });

    // Respond with AI output
    const answer = response.choices?.[0]?.message?.content || "No response.";
    return res.status(200).json({ answer });
  } catch (err) {
    console.error("API Error:", err.response?.data || err.message || err);
    return res.status(500).json({
      error: "Server error",
      details: err.response?.data || err.message,
    });
  }
}
