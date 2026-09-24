/**
 * services/ai.js: AI 추천 엔진 (비용 0원 3대 전략 구현)
 * 1. BYOK (Gemini API Key in LocalStorage)
 * 2. Gemini Free Tier Proxy (/api/recommend)
 * 3. 클라이언트 규칙 기반 파서 (기본값 / 비용 0원, 0.1초 즉시 추천)
 */

export async function recommendGamesByAiPrompt(promptText, games, apiKey = '') {
  if (!promptText || !promptText.trim()) return [];

  // 1. BYOK (사용자가 설정 모달에 입력한 개인 Gemini API Key) 직접 호출 시도
  if (apiKey && apiKey.trim()) {
    try {
      const result = await fetchGeminiRecommendation(promptText, games, apiKey.trim());
      if (result && result.length > 0) {
        return result;
      }
    } catch (err) {
      console.warn("BYOK Gemini API 호출 실패. 클라이언트 0원 규칙 파서로 폴백합니다:", err);
    }
  }

  // 2. Vercel 서버리스 Gemini Free Tier 프록시 (/api/recommend) 호출 시도
  if (window.location.protocol.startsWith('http')) {
    try {
      const resp = await fetch('/api/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: promptText, games: games, apiKey: apiKey })
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.recommendations && Array.isArray(data.recommendations)) {
          const mapped = mapAiResultsToGames(data.recommendations, games);
          if (mapped.length > 0) return mapped;
        }
      }
    } catch (e) {
      // 프록시 실패 시 폴백
    }
  }

  // 3. 기본값: API Key 없이도 브라우저 내부 100% 무료 클라이언트 규칙 파서 즉시 실행
  return recommendGamesByAiPromptRuleBased(promptText, games);
}

function mapAiResultsToGames(recommendations, games) {
  const result = [];
  for (const rec of recommendations) {
    const matchedGame = games.find(g =>
      g.name.toLowerCase() === (rec.gameName || '').toLowerCase() ||
      g.name.includes(rec.gameName) ||
      (rec.gameName && rec.gameName.includes(g.name))
    );
    if (matchedGame) {
      result.push({
        game: matchedGame,
        score: rec.score || 95,
        reason: rec.reason || 'AI 추천 조건 부합'
      });
    }
  }
  return result;
}

async function fetchGeminiRecommendation(promptText, games, apiKey) {
  const gameListText = games.slice(0, 100).map(g =>
    `- ${g.name} (인원: ${g.minPlayers || '?'}-${g.maxPlayers || '?'}인, 베스트: ${g.bestPlayers || '-'}, 난이도: ${g.difficulty || '-'}, 시스템: ${g.system || '-'})`
  ).join('\n');

  const systemInstruction = `당신은 보드게임 추천 전문가 AI입니다. 아래 제공된 사용자의 보드게임 컬렉션 목록 중에서 요청에 가장 적합한 게임 3개를 골라 JSON 형식으로 응답하세요.
응답은 오직 다음 JSON 구조만 포함해야 합니다:
[
  { "gameName": "게임명", "score": 95, "reason": "추천 사유" }
]`;

  const requestBody = {
    contents: [{
      parts: [
        { text: `${systemInstruction}\n\n[보유 컬렉션 목록]\n${gameListText}\n\n[사용자 요청]\n${promptText}` }
      ]
    }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json"
    }
  };

  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  const resp = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });

  if (!resp.ok) throw new Error(`Gemini API error: ${resp.status}`);

  const data = await resp.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return [];

  const parsed = JSON.parse(text);
  return mapAiResultsToGames(parsed, games);
}

export function recommendGamesByAiPromptRuleBased(promptText, games) {
  if (!promptText || !promptText.trim()) return [];

  const query = promptText.toLowerCase();

  // 1. 인원 키워드 추출
  let targetPlayers = null;
  const playerMatch = query.match(/(\d+)\s*명|(\d+)\s*인/);
  if (playerMatch) {
    targetPlayers = parseInt(playerMatch[1] || playerMatch[2], 10);
  }

  // 2. 난이도 키워드 감지
  const isHeavy = query.includes('헤비') || query.includes('어려운') || query.includes('상급') || query.includes('마니아');
  const isEasy = query.includes('입문') || query.includes('쉬운') || query.includes('초보') || query.includes('가벼운');

  // 3. 점수 가중치 기반 매칭 알고리즘
  const scoredGames = games.map(g => {
    let score = 50;
    const reasons = [];

    // 인원 조건 평가
    if (targetPlayers !== null) {
      if (g.minPlayers && targetPlayers >= g.minPlayers && g.maxPlayers && targetPlayers <= g.maxPlayers) {
        score += 25;
        reasons.push(`${targetPlayers}인 플레이 적합`);
      }
      if (g.bestPlayers && g.bestPlayers.includes(String(targetPlayers))) {
        score += 20;
        reasons.push(`${targetPlayers}인 베스트 인원 매칭`);
      }
    }

    // 난이도 조건 평가
    if (isEasy && (g.difficulty === '입문' || g.difficulty === '하' || g.difficulty === '초급')) {
      score += 20;
      reasons.push('부담 없이 즐기는 쉬운 난이도');
    } else if (isHeavy && (g.difficulty === '상' || g.difficulty === '중')) {
      score += 20;
      reasons.push('전략적 요소가 풍부한 깊이 있는 난이도');
    }

    // 메커니즘/태그 키워드 평가
    if (g.system) {
      const sysList = g.system.split(/[,/]/).map(s => s.trim());
      for (const sys of sysList) {
        if (query.includes(sys.toLowerCase())) {
          score += 30;
          reasons.push(`요청하신 메커니즘 '${sys}' 메인 요소 포함`);
        }
      }
    }

    if (reasons.length === 0) {
      reasons.push('컬렉션 데이터 기반 종합 최적 추천');
    }

    return {
      game: g,
      score: Math.min(score, 99),
      reason: reasons.join(', ')
    };
  });

  scoredGames.sort((a, b) => b.score - a.score);
  return scoredGames.slice(0, 3);
}
