/**
 * BGGService: BoardGameGeek XMLAPI2 연동 모듈
 * 게임명 검색 및 상세 정보(인원수, 베스트 인원, 긱 난이도/웨이트, 시스템, 썸네일) 파싱
 */

class BGGService {
  constructor(sheetsService) {
    this.sheetsService = sheetsService;
    this.parser = new DOMParser();
    
    // 영문 메커니즘 -> 한글 매핑 딕셔너리
    this.mechanicMap = {
      'Hand Management': '핸드관리',
      'Worker Placement': '일꾼놓기',
      'Worker Placement, Different Worker Types': '일꾼놓기',
      'Deck, Bag, and Pool Building': '덱빌딩',
      'Deck Construction': '덱빌딩',
      'Tile Placement': '타일놓기',
      'Trick-taking': '트릭테이킹',
      'Set Collection': '셋컬렉션',
      'Drafting': '드래프팅',
      'Card Drafting': '카드 드래프팅',
      'Open Drafting': '드래프팅',
      'Closed Drafting': '드래프팅',
      'Push Your Luck': '푸시유어럭',
      'Bluffing': '블러핑',
      'Betting and Bluffing': '배팅/블러핑',
      'Cooperative Game': '협력',
      'Area Majority / Influence': '영향력',
      'Dice Rolling': '주사위',
      'Memory': '메모리',
      'Auction / Bidding': '경매',
      'Paper-and-Pencil': '롤앤라',
      'Traitor Game': '마피아',
      'Deduction': '추리',
      'Variable Player Powers': '비대칭능력',
      'Engine Building': '엔진빌딩',
      'Network and Route Building': '네트워크 구축',
      'Trading': '거래/협상',
      'Pattern Building': '패턴구축',
      'Take That': '인터랙션',
      'Action Points': '액션포인트',
      'Grid Movement': '그리드이동',
      'Simultaneous Action Selection': '동시액션',
      'Variable Phase Order': '가변페이즈',
      'Climbing': '클라이밍/핸드털기',
      'Dexterity': '덱스터리티',
      'Hidden Roles': '마피아/비밀역할'
    };
  }

  getSettings() {
    return this.sheetsService.settings;
  }

  /**
   * BGG API 요청 (CORS 프록시 및 Bearer 토큰 처리)
   */
  async fetchXml(url) {
    const settings = this.getSettings();
    const headers = {};
    if (settings.bggToken && settings.bggToken.trim()) {
      headers['Authorization'] = `Bearer ${settings.bggToken.trim()}`;
    }

    const isHttp = window.location.protocol.startsWith('http');
    let vercelUrl = null;
    if (isHttp) {
      if (url.includes('/search?query=')) {
        const qMatch = url.match(/query=([^&]+)/);
        if (qMatch) vercelUrl = `/api/bgg?endpoint=search&query=${qMatch[1]}`;
      } else if (url.includes('/thing?id=')) {
        const idMatch = url.match(/id=([^&]+)/);
        if (idMatch) vercelUrl = `/api/bgg?endpoint=thing&id=${idMatch[1]}`;
      }
    }

    // 1차: Vercel 서버리스 프록시, 2차: allorigins, 3차: corsproxy, 4차: 직접 호출
    const proxyUrls = [
      vercelUrl,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
      `https://corsproxy.io/?${encodeURIComponent(url)}`,
      url
    ].filter(Boolean);

    let lastError = null;
    for (const fetchUrl of proxyUrls) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); // 8초 타임아웃

        const resp = await fetch(fetchUrl, {
          headers: fetchUrl === url ? headers : {},
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!resp.ok) continue;
        const text = await resp.text();
        
        // 유효한 XML인지 검사
        if (text && text.includes('<') && (text.includes('<items') || text.includes('<item') || text.includes('<thing'))) {
          return this.parser.parseFromString(text, "text/xml");
        }
      } catch (err) {
        lastError = err;
      }
    }

    throw new Error(lastError ? `BGG 요청 실패: ${lastError.message}` : "BGG 데이터를 가져올 수 없습니다.");
  }

  /**
   * 1. 게임명 검색 (Search)
   * @param {string} query 검색어 (예: "Catan", "카탄", "Terraforming Mars")
   * @returns {Promise<Array>} 검색 결과 목록 [{ id, name, year }]
   */
  async searchGames(query) {
    if (!query || !query.trim()) return [];
    
    const url = `https://boardgamegeek.com/xmlapi2/search?query=${encodeURIComponent(query.trim())}&type=boardgame`;
    const xmlDoc = await this.fetchXml(url);

    const items = xmlDoc.querySelectorAll('item');
    const results = [];

    items.forEach(item => {
      const id = item.getAttribute('id');
      const nameEl = item.querySelector('name');
      const yearEl = item.querySelector('yearpublished');

      results.push({
        id: id,
        name: nameEl ? nameEl.getAttribute('value') : '이름 없음',
        year: yearEl ? yearEl.getAttribute('value') : ''
      });
    });

    return results.slice(0, 15); // 상위 15개
  }

  /**
   * 2. 게임 상세 정보 조회 및 시트 규격에 맞게 변환 (Thing Detail)
   * @param {string} bggId BGG 게임 ID
   */
  async getGameDetails(bggId) {
    const url = `https://boardgamegeek.com/xmlapi2/thing?id=${bggId}&stats=1`;
    const xmlDoc = await this.fetchXml(url);

    const item = xmlDoc.querySelector('item');
    if (!item) throw new Error("게임 상세 정보를 찾을 수 없습니다.");

    // 게임명 (Primary)
    const primaryNameEl = item.querySelector('name[type="primary"]');
    const primaryName = primaryNameEl ? primaryNameEl.getAttribute('value') : '';

    // 한글 또는 기타 대체 이름 확인
    let koreanName = '';
    const alternateNames = item.querySelectorAll('name[type="alternate"]');
    for (const alt of alternateNames) {
      const val = alt.getAttribute('value');
      if (/[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(val)) {
        koreanName = val;
        break;
      }
    }

    // 이미지 및 썸네일
    const thumbnailEl = item.querySelector('thumbnail');
    const imageEl = item.querySelector('image');
    const thumbnail = thumbnailEl ? thumbnailEl.textContent : '';
    const image = imageEl ? imageEl.textContent : '';

    // 인원수
    const minPlayersEl = item.querySelector('minplayers');
    const maxPlayersEl = item.querySelector('maxplayers');
    const minPlayers = minPlayersEl ? parseInt(minPlayersEl.getAttribute('value'), 10) : null;
    const maxPlayers = maxPlayersEl ? parseInt(maxPlayersEl.getAttribute('value'), 10) : null;

    // 플레이 타임
    const minTimeEl = item.querySelector('minplaytime');
    const maxTimeEl = item.querySelector('maxplaytime');
    const playTime = maxTimeEl ? maxTimeEl.getAttribute('value') : (minTimeEl ? minTimeEl.getAttribute('value') : '');

    // 베스트 인원 (Community Poll 계산)
    const bestPlayers = this.calculateBestPlayers(item);

    // 긱 웨이트(난이도) 및 시트 난이도로 변환
    const weightEl = item.querySelector('statistics ratings averageweight');
    const bggWeight = weightEl ? parseFloat(weightEl.getAttribute('value')) : 0;
    const difficulty = this.convertWeightToDifficulty(bggWeight);

    // 긱 평점
    const ratingEl = item.querySelector('statistics ratings average');
    const bggRating = ratingEl ? parseFloat(ratingEl.getAttribute('value')).toFixed(1) : '';

    // 게임 시스템 / 메커니즘 추출
    const mechanics = [];
    item.querySelectorAll('link[type="boardgamemechanic"]').forEach(link => {
      const enVal = link.getAttribute('value');
      const koVal = this.mechanicMap[enVal] || enVal;
      if (!mechanics.includes(koVal)) {
        mechanics.push(koVal);
      }
    });

    return {
      bggId,
      name: koreanName || primaryName,
      englishName: primaryName,
      thumbnail: thumbnail || image,
      minPlayers: minPlayers || null,
      maxPlayers: maxPlayers || null,
      bestPlayers: bestPlayers || '',
      difficulty: difficulty,
      bggWeight: bggWeight ? bggWeight.toFixed(2) : '',
      bggRating: bggRating,
      system: mechanics.slice(0, 4).join(', '), // 주요 시스템 상위 4개
      playTime: playTime ? `${playTime}분` : '',
      description: (item.querySelector('description') ? item.querySelector('description').textContent : '')
        .replace(/&#10;/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    };
  }

  /**
   * 커뮤니티 투표(suggested_numplayers)로부터 베스트 인원 도출
   */
  calculateBestPlayers(item) {
    const poll = item.querySelector('poll[name="suggested_numplayers"]');
    if (!poll) return '';

    const results = poll.querySelectorAll('results');
    let bestNum = '';
    let maxBestVotes = -1;

    results.forEach(res => {
      const numPlayers = res.getAttribute('numplayers');
      const bestVoteEl = res.querySelector('result[value="Best"]');
      if (bestVoteEl) {
        const votes = parseInt(bestVoteEl.getAttribute('numvotes'), 10) || 0;
        if (votes > maxBestVotes && votes > 3) {
          maxBestVotes = votes;
          bestNum = numPlayers;
        }
      }
    });

    return bestNum ? bestNum.replace('+', '인+') : '';
  }

  /**
   * BGG Weight (1.0 ~ 5.0) -> 시트 난이도 (입문, 하, 중하, 중, 상) 매핑
   */
  convertWeightToDifficulty(weight) {
    if (!weight || weight === 0) return '';
    if (weight < 1.6) return '입문';
    if (weight < 2.2) return '하';
    if (weight < 2.85) return '중하';
    if (weight < 3.6) return '중';
    return '상';
  }
}

window.BGGService = BGGService;
