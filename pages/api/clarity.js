import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { message } = req.body;

  try {
    const response = await client.chat.completions.create({
      model: "g-68e1d4cf8c248191a32369a47a035680", // custom GPT
      messages: [
        {
          role: "system",
          content:
            "You are Clarity, an ingredient safety assistant for maternal, infant, and breastfeeding contexts.",
        },
        { role: "user", content: message },
      ],
    });

    res.status(200).json({ answer: response.choices[0].message.content });
  } catch (err) {
    console.error("API Error:", err.response?.data || err.message);
    res
      .status(500)
      .json({ error: err.response?.data || err.message || "Server error" });
  }
}
