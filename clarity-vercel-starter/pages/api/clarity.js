export default async function handler(req, res) {
  try {
    console.log("Handler triggered"); // This should show in Vercel logs
    res.status(200).json({ success: true, msg: "Handler reached" });
  } catch (err) {
    console.error("API handler failed:", err);
    res.status(500).json({ success: false, error: "Internal error" });
  }
}
