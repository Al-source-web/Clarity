export default async function handler(req, res) {
  try {
    console.log('Incoming request:', req.body);

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { message, mode } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    if (!process.env.OPENAI_API_KEY) {
      console.error('Missing API key');
      return res.status(500).json({ error: 'Missing OpenAI API key' });
    }

    return res.status(200).json({ debug: 'All checks passed', message, mode });
  } catch (error) {
    console.error('Crash:', error);
    return res.status(500).json({ error: 'Server crashed' });
  }
}
