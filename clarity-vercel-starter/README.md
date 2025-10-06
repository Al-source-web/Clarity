# Clarity (Vercel Starter)

This is a minimal, production-ready wrapper to embed Clarity as a native chat on your site.

## Files
- `public/index.html` – UI (logo, chat window)
- `public/script.js` – client logic
- `api/clarity.js` – serverless endpoint that forwards to OpenAI (keeps your API key secret)

## Deploy on Vercel
1) Create a new project at https://vercel.com
2) Import this folder (via GitHub or drag-and-drop).
3) In the Vercel project → **Settings → Environment Variables**:
   - Add `OPENAI_API_KEY = your key`
4) Deploy. Your site will be available at `https://YOUR-PROJECT.vercel.app`.

## Embed in Squarespace
Add a **Code** (or **Embed**) block and paste:

```html
<iframe src="https://YOUR-PROJECT.vercel.app"
        width="100%" height="700"
        style="border:none; border-radius:12px; overflow:hidden;"></iframe>
```

Users stay on your site; no external ChatGPT UI is used.

## Notes
- Colors are harmonized to Health AI emerald (#004d40). Adjust in `index.html` :root.
- This starter avoids shopping links and keeps tone safe and clear.
