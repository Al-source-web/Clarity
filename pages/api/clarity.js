import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // set this in Vercel → Environment Variables
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { message } = req.body;

  try {
    const response = await client.chat.completions.create({
      model: "g-68e1d4cf8c248191a32369a47a035680", // 🔑 your custom GPT ID
      messages: [
        {
          role: "system",
          content: "You are Clarity, an ingredient safety assistant for maternal, infant, and breastfeeding contexts.",
        },
        {
          role: "user",
          content: message,
        },
      ],
    });

    res.status(200).json({ answer: response.choices[0].message.content });
  } catch (err) {
    console.error("API Error:", err.response?.data || err.message);
    res.status(500).json({ error: "Server error" });
  }
}
