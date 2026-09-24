// Vercel Serverless Function: /api/recommend
// Gemini Free Tier Proxy (비용 0원 AI 추천 서버리스 프록시)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt, games, apiKey } = req.body || {};
  const geminiKey = apiKey || process.env.GEMINI_API_KEY;

  if (!geminiKey) {
    return res.status(400).json({ error: 'Gemini API Key is missing' });
  }

  try {
    const gameListText = (games || []).slice(0, 100).map(g =>
      `- ${g.name} (인원: ${g.minPlayers || '?'}-${g.maxPlayers || '?'}인, 베스트: ${g.bestPlayers || '-'}, 난이도: ${g.difficulty || '-'}, 시스템: ${g.system || '-'})`
    ).join('\n');

    const systemInstruction = `당신은 보드게임 추천 전문가 AI입니다. 사용자의 보유 컬렉션 목록 중에서 사용자의 요청 조건에 가장 부합하는 게임 3개를 골라 JSON 형식으로만 응답하세요.
반드시 아래 JSON 배열 형식으로만 출력해야 합니다:
[
  { "gameName": "게임명", "score": 95, "reason": "추천 사유 상세" }
]`;

    const requestBody = {
      contents: [{
        parts: [
          { text: `${systemInstruction}\n\n[보유 컬렉션 목록]\n${gameListText}\n\n[사용자 요청]\n${prompt}` }
        ]
      }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json"
      }
    };

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: 'Gemini API Error', details: errText });
    }

    const data = await response.json();
    const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidateText) {
      return res.status(500).json({ error: 'Empty response from Gemini' });
    }

    const jsonParsed = JSON.parse(candidateText);
    return res.status(200).json({ recommendations: jsonParsed });

  } catch (error) {
    console.error('Gemini proxy error:', error);
    return res.status(500).json({ error: 'Failed to process recommendation', details: error.message });
  }
}
