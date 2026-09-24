/**
 * BGGService: BoardGameGeek XMLAPI2 연동 모듈
 * 게임명 검색, 상세 정보 및 사용자 계정 컬렉션(Collection/Wishlist) 파싱
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
      } else if (url.includes('/collection?username=')) {
        const uMatch = url.match(/username=([^&]+)/);
        if (uMatch) vercelUrl = `/api/bgg?endpoint=collection&username=${uMatch[1]}`;
      }
    }

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
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        const resp = await fetch(fetchUrl, {
          headers: fetchUrl === url ? headers : {},
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!resp.ok) continue;
        const text = await resp.text();
        
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

    return results.slice(0, 15);
  }

  /**
   * 2. 게임 상세 정보 조회 (Thing Detail)
   */
  async getGameDetails(bggId) {
    const url = `https://boardgamegeek.com/xmlapi2/thing?id=${bggId}&stats=1`;
    const xmlDoc = await this.fetchXml(url);

    const item = xmlDoc.querySelector('item');
    if (!item) throw new Error("게임 상세 정보를 찾을 수 없습니다.");

    const primaryNameEl = item.querySelector('name[type="primary"]');
    const primaryName = primaryNameEl ? primaryNameEl.getAttribute('value') : '';

    let koreanName = '';
    const alternateNames = item.querySelectorAll('name[type="alternate"]');
    for (const alt of alternateNames) {
      const val = alt.getAttribute('value');
      if (/[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(val)) {
        koreanName = val;
        break;
      }
    }

    const thumbnailEl = item.querySelector('thumbnail');
    const imageEl = item.querySelector('image');
    const thumbnail = thumbnailEl ? thumbnailEl.textContent : '';
    const image = imageEl ? imageEl.textContent : '';

    const minPlayersEl = item.querySelector('minplayers');
    const maxPlayersEl = item.querySelector('maxplayers');
    const minPlayers = minPlayersEl ? parseInt(minPlayersEl.getAttribute('value'), 10) : null;
    const maxPlayers = maxPlayersEl ? parseInt(maxPlayersEl.getAttribute('value'), 10) : null;

    const minTimeEl = item.querySelector('minplaytime');
    const maxTimeEl = item.querySelector('maxplaytime');
    const playTime = maxTimeEl ? maxTimeEl.getAttribute('value') : (minTimeEl ? minTimeEl.getAttribute('value') : '');

    const bestPlayers = this.calculateBestPlayers(item);

    const weightEl = item.querySelector('statistics ratings averageweight');
    const bggWeight = weightEl ? parseFloat(weightEl.getAttribute('value')) : 0;
    const difficulty = this.convertWeightToDifficulty(bggWeight);

    const ratingEl = item.querySelector('statistics ratings average');
    const bggRating = ratingEl ? parseFloat(ratingEl.getAttribute('value')).toFixed(1) : '';

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
      system: mechanics.slice(0, 4).join(', '),
      playTime: playTime ? `${playTime}분` : '',
      description: (item.querySelector('description') ? item.querySelector('description').textContent : '')
        .replace(/&#10;/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    };
  }

  /**
   * [Phase 2] 3. BGG 사용자 컬렉션/위시리스트 API 파싱 (Collection API)
   * @param {string} username BGG 계정 ID
   * @param {string} type 'own' | 'wishlist'
   */
  async getUserCollection(username, type = 'own') {
    if (!username || !username.trim()) return [];

    let queryParam = type === 'wishlist' ? 'wishlist=1' : 'own=1';
    const url = `https://boardgamegeek.com/xmlapi2/collection?username=${encodeURIComponent(username.trim())}&${queryParam}&stats=1`;
    const xmlDoc = await this.fetchXml(url);

    const items = xmlDoc.querySelectorAll('item');
    const results = [];

    items.forEach(item => {
      const nameEl = item.querySelector('name');
      const statsEl = item.querySelector('stats');

      const minP = statsEl ? parseInt(statsEl.getAttribute('minplayers'), 10) : null;
      const maxP = statsEl ? parseInt(statsEl.getAttribute('maxplayers'), 10) : null;
      const playTime = statsEl ? statsEl.getAttribute('maxplaytime') : '';

      const ratingEl = item.querySelector('stats rating averageweight');
      const weight = ratingEl ? parseFloat(ratingEl.getAttribute('value')) : 0;
      const diff = this.convertWeightToDifficulty(weight);

      const name = nameEl ? nameEl.textContent : 'BGG Game';

      results.push({
        name: name,
        minPlayers: minP,
        maxPlayers: maxP,
        difficulty: diff,
        owner: `${username} (${type === 'wishlist' ? '위시' : 'BGG'})`,
        notes: `BGG ${type === 'wishlist' ? '위시리스트' : '컬렉션'} 임포트 ${playTime ? '/ 플레이시간: ' + playTime + '분' : ''}`
      });
    });

    return results;
  }

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
