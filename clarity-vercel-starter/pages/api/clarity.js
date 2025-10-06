export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*'); // Allow all domains
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end(); // Handle preflight
    return;
  }

  if (req.method === 'POST') {
    const { message, mode } = req.body;
    console.log("Received message:", message, "Mode:", mode);
    res.status(200).json({ answer: `You said: ${message} in ${mode} mode.` });
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
