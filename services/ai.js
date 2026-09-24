/**
 * services/ai.js: 자연어 입력 조건 분석 및 키워드 매칭 AI 추천 엔진
 */

export function recommendGamesByAiPrompt(promptText, games) {
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
