const chat = document.getElementById('chat');
const input = document.getElementById('q');
const sendBtn = document.getElementById('send');
const voiceSel = document.getElementById('voice');

function addMsg(role, text) {
  const wrap = document.createElement('div');
  wrap.className = `msg ${role}`;
  const b = document.createElement('div');
  b.className = 'bubble';
  b.textContent = text;
  wrap.appendChild(b);
  chat.appendChild(wrap);
  chat.scrollTop = chat.scrollHeight;
}

async function ask() {
  const text = input.value.trim();
  if (!text) return;

  addMsg('you', text);
  input.value = '';

  try {
    const res = await fetch('https://clarity-mu-green.vercel.app/api/clarity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, mode: voiceSel?.value || 'best_friend' }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("Backend error:", err);
      addMsg('ai', '⚠️ Sorry — server error. Try again.');
      return;
    }

    const data = await res.json();
    addMsg('ai', data.answer || '⚠️ No response.');
  } catch (e) {
    console.error("Network error:", e);
    addMsg('ai', '⚠️ Network error.');
  }
}

sendBtn.addEventListener('click', ask);
input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ask(); });
