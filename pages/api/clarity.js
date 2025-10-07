import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { message, mode } = req.body;

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini", // or your custom GPT ID
      messages: [
        { role: "system", content: "You are Clarity, an ingredient safety assistant." },
        { role: "user", content: message }
      ]
    });

    res.status(200).json({ answer: response.choices[0].message.content });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
}
