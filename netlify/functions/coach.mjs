// Soru koçu ve taslak yazma için Gemini aracısı.
// Gemini anahtarı yalnızca Netlify ortam değişkeninde (GEMINI_API_KEY) durur; tarayıcıya hiç gönderilmez.

const MODEL = 'gemini-3.8-flash';
// Firebase web anahtarı gizli değildir (sayfada zaten görünür); yalnızca oturum doğrulamak için kullanılır.
const FIREBASE_WEB_KEY = process.env.FIREBASE_WEB_API_KEY || 'AIzaSyBNPIIl0HjZtmO264uLIJco8KZRWgAM7mI';

const SYSTEMS = {
  coach: 'Sen Sınavım platformunda öğrencilere yardım eden, Türkçe konuşan bir ders koçusun. Kısa, net ve arkadaşça yanıt ver. Cevabı doğrudan vermek yerine önce yol göster, gerekirse örnek çöz.',
  draft: 'Sen bir öğretmen yardımcısısın. Türkçe yaz.'
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return json({ error: 'not_configured' }, 500);

  // Yalnızca giriş yapmış kullanıcılar: Firebase kimlik belirtecini doğrula.
  const idToken = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!idToken) return json({ error: 'unauthorized' }, 401);
  try {
    const check = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_WEB_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken })
    });
    if (!check.ok) return json({ error: 'unauthorized' }, 401);
  } catch (_) {
    return json({ error: 'auth_unavailable' }, 502);
  }

  let payload;
  try { payload = await req.json(); } catch (_) { return json({ error: 'bad_request' }, 400); }

  const mode = payload?.mode;
  if (!SYSTEMS[mode]) return json({ error: 'bad_request' }, 400);

  let messages = Array.isArray(payload.messages) ? payload.messages : [];
  messages = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'model') && typeof m.text === 'string' && m.text.trim())
    .slice(-10)
    .map((m) => ({ role: m.role, text: m.text.slice(0, 2000) }));
  if (!messages.length || messages[messages.length - 1].role !== 'user') return json({ error: 'bad_request' }, 400);

  // Taslak isteğinde komut sunucuda kurulur; istemci yalnızca başlığı gönderir.
  if (mode === 'draft') {
    const title = messages[messages.length - 1].text.slice(0, 200);
    messages = [{ role: 'user', text: `"${title}" konusu için öğrencilere yönelik kısa bir ders notu hazırla. Sadece HTML gövde içeriği ver (h2, p, ul kullan), kod bloğu işareti kullanma.` }];
  }

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEMS[mode] }] },
        contents: messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] }))
      })
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      console.error('Gemini hatası', res.status, data.error?.message);
      return json({ error: 'upstream' }, 502);
    }
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    return text ? json({ text }) : json({ error: 'empty' }, 502);
  } catch (e) {
    console.error(e);
    return json({ error: 'upstream' }, 502);
  }
};
