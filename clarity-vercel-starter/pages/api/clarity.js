import { OpenAI } from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // Make sure this is set in your Vercel environment variables
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message, mode } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const systemPrompt =
      mode === 'scientific'
        ? "You are a scientific researcher trained in allergen safety, breastfeeding nutrition, and histamine/mast cell reactions. Respond clearly and concisely, with references where possible."
        : "You are a supportive friend helping a new mom navigate ingredient safety for breastfeeding and histamine triggers. Be warm and easy to understand.";

    const completion = await openai.chat.completions.create({
      model: 'gpt-4', // or "gpt-3.5-turbo"
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      temperature: 0.7,
    });

    const answer = completion.choices?.[0]?.message?.content || 'No response.';
    res.status(200).json({ answer });
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
}
