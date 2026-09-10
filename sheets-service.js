/**
 * SheetsService: 구글 스프레드시트 데이터 연동 및 Google Apps Script 통신 모듈
 */

const DEFAULT_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTWcH2CPw1KzrlIZLTZ12uYABfTa7flyqg-EVwlZfIy2icyWJJ4TqSHN9WFGBbFKnrl9WPspzHchnbQ/pub?output=csv";
const STORAGE_KEY_GAMES = "bg_manager_games_cache";
const STORAGE_KEY_SETTINGS = "bg_manager_settings";
const STORAGE_KEY_LOCAL_CHANGES = "bg_manager_local_changes";

class SheetsService {
  constructor() {
    this.settings = this.loadSettings();
  }

  loadSettings() {
    const saved = localStorage.getItem(STORAGE_KEY_SETTINGS);
    const defaults = {
      csvUrl: DEFAULT_CSV_URL,
      gasUrl: "", // Google Apps Script Web App URL (실시간 읽기/쓰기 100% 지원)
      bggToken: "",
      bggProxy: "https://api.allorigins.win/raw?url="
    };
    if (saved) {
      try {
        return { ...defaults, ...JSON.parse(saved) };
      } catch (e) {
        console.error("설정 파싱 에러:", e);
      }
    }
    return defaults;
  }

  saveSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(this.settings));
  }

  /**
   * RFC 4180 표준 준수 CSV 파서
   */
  parseCSV(csvText) {
    const rows = [];
    let currentRow = [];
    let currentField = '';
    let insideQuotes = false;

    const text = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const nextChar = text[i + 1];

      if (char === '"') {
        if (insideQuotes && nextChar === '"') {
          currentField += '"';
          i++;
        } else {
          insideQuotes = !insideQuotes;
        }
      } else if (char === ',' && !insideQuotes) {
        currentRow.push(currentField.trim());
        currentField = '';
      } else if (char === '\n' && !insideQuotes) {
        currentRow.push(currentField.trim());
        if (currentRow.length > 1 || (currentRow.length === 1 && currentRow[0] !== '')) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = '';
      } else {
        currentField += char;
      }
    }

    if (currentField !== '' || currentRow.length > 0) {
      currentRow.push(currentField.trim());
      rows.push(currentRow);
    }

    return rows;
  }

  /**
   * CSV 문자열을 파싱하여 게임 목록 객체로 변환
   */
  convertCsvToGames(csvText) {
    const rows = this.parseCSV(csvText);
    if (rows.length === 0) return [];

    let headerIndex = -1;
    for (let i = 0; i < Math.min(5, rows.length); i++) {
      if (rows[i].some(col => col.includes('게임명') || col.includes('게임'))) {
        headerIndex = i;
        break;
      }
    }
    if (headerIndex === -1) headerIndex = 0;

    const dataRows = rows.slice(headerIndex + 1);
    const games = [];

    dataRows.forEach((cols, idx) => {
      const name = cols[0] ? cols[0].trim() : '';
      if (!name) return;

      const minP = parseInt(cols[1], 10);
      const maxP = parseInt(cols[2], 10);

      games.push({
        id: `row_${headerIndex + 2 + idx}`,
        rowIndex: headerIndex + 2 + idx,
        name: name,
        minPlayers: isNaN(minP) ? null : minP,
        maxPlayers: isNaN(maxP) ? null : maxP,
        system: cols[3] ? cols[3].trim() : '',
        notes: cols[4] ? cols[4].trim() : '',
        bestPlayers: cols[5] ? cols[5].trim() : '',
        difficulty: cols[6] ? cols[6].trim() : '',
        owner: cols[7] ? cols[7].trim() : '',
        isLocal: false
      });
    });

    return games;
  }

  /**
   * 스프레드시트 데이터 불러오기
   * 1순위: Google Apps Script Web App (설정 시 실시간 시트 원본 무결성 조회, CORS 없음)
   * 2순위: 캐시 확인 (새로고침 아닐 때)
   * 3순위: CSV fetch (직접 시도 및 다중 프록시 시도)
   * 4순위: 브라우저 캐시 / 내장 초기 데이터 (INITIAL_BOARD_GAMES)
   */
  async fetchGames(forceRefresh = false) {
    // 1. Google Apps Script 연동되어 있다면 GAS를 통해 100% 무결성 데이터 조회
    if (this.settings.gasUrl && this.settings.gasUrl.trim().startsWith('https://script.google.com/')) {
      try {
        const gasFetchUrl = this.settings.gasUrl.includes('?') 
          ? `${this.settings.gasUrl}&action=get` 
          : `${this.settings.gasUrl}?action=get`;
        
        const resp = await fetch(gasFetchUrl);
        if (resp.ok) {
          const result = await resp.json();
          if (result.status === 'success' && Array.isArray(result.data)) {
            this.saveCache(result.data);
            return this.applyLocalChanges(result.data);
          }
        }
      } catch (gasErr) {
        console.warn("Google Apps Script 조회 실패, CSV로 폴백합니다:", gasErr);
      }
    }

    // 2. 캐시 확인
    if (!forceRefresh) {
      const cached = localStorage.getItem(STORAGE_KEY_GAMES);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (parsed && parsed.data && parsed.data.length > 0) {
            return this.applyLocalChanges(parsed.data);
          }
        } catch (e) {
          console.warn("캐시 파싱 실패:", e);
        }
      }
    }

    // 3. 원격 CSV 가져오기 (CORS 우회 다중 전략)
    let rawCsv = null;
    let targetUrl = (this.settings.csvUrl || DEFAULT_CSV_URL).trim();
    // pubhtml을 입력했을 경우 pub?output=csv로 자동 치환
    if (targetUrl.endsWith('/pubhtml')) {
      targetUrl = targetUrl.replace(/\/pubhtml$/, '/pub?output=csv');
    }

    // 후보 엔드포인트들 (Vercel 배포 환경일 경우 서버리스 함수 /api/sheets를 1순위로 호출하여 CORS 완전 해결)
    const isHttp = window.location.protocol.startsWith('http');
    const fetchEndpoints = [
      isHttp ? '/api/sheets' : null,
      targetUrl,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
      `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`
    ].filter(Boolean);

    for (const url of fetchEndpoints) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);
        const resp = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        if (resp.ok) {
          const text = await resp.text();
          if (text && (text.includes('게임명') || text.includes(','))) {
            rawCsv = text;
            break;
          }
        }
      } catch (err) {
        // 다음 엔드포인트 시도
      }
    }

    if (rawCsv) {
      const parsedGames = this.convertCsvToGames(rawCsv);
      if (parsedGames.length > 0) {
        this.saveCache(parsedGames);
        return this.applyLocalChanges(parsedGames);
      }
    }

    // 4. 네트워크/CORS 차단 시: 내장 데이터(initial-data.js) 또는 로컬 캐시로 안전 폴백
    const fallbackCache = localStorage.getItem(STORAGE_KEY_GAMES);
    if (fallbackCache) {
      try {
        const cachedData = JSON.parse(fallbackCache).data;
        if (cachedData && cachedData.length > 0) {
          return this.applyLocalChanges(cachedData);
        }
      } catch (e) {}
    }

    if (window.INITIAL_BOARD_GAMES && Array.isArray(window.INITIAL_BOARD_GAMES) && window.INITIAL_BOARD_GAMES.length > 0) {
      this.saveCache(window.INITIAL_BOARD_GAMES);
      return this.applyLocalChanges(window.INITIAL_BOARD_GAMES);
    }

    throw new Error("스프레드시트를 불러올 수 없습니다. 브라우저 CORS 제한일 수 있으니 [설정]에서 Google Apps Script를 연동하거나 CSV 파일을 업로드해주세요.");
  }

  saveCache(games) {
    localStorage.setItem(STORAGE_KEY_GAMES, JSON.stringify({
      timestamp: Date.now(),
      data: games
    }));
  }

  /**
   * 로컬에서 수동 업로드한 CSV 텍스트 적용
   */
  importCsvText(csvText) {
    const games = this.convertCsvToGames(csvText);
    if (games.length === 0) throw new Error("유효한 보드게임 데이터 행을 찾을 수 없습니다.");
    this.saveCache(games);
    return this.applyLocalChanges(games);
  }

  /**
   * 로컬 변경 사항(추가/수정/삭제) 병합
   */
  applyLocalChanges(baseGames) {
    const localChangesRaw = localStorage.getItem(STORAGE_KEY_LOCAL_CHANGES);
    if (!localChangesRaw) return baseGames;

    try {
      const localChanges = JSON.parse(localChangesRaw);
      let updatedGames = [...baseGames];

      if (localChanges.deleted && localChanges.deleted.length > 0) {
        const deletedIds = new Set(localChanges.deleted);
        updatedGames = updatedGames.filter(g => !deletedIds.has(g.id) && !deletedIds.has(g.name));
      }

      if (localChanges.updated && localChanges.updated.length > 0) {
        const updateMap = new Map(localChanges.updated.map(u => [u.id || u.name, u]));
        updatedGames = updatedGames.map(g => {
          if (updateMap.has(g.id)) return { ...g, ...updateMap.get(g.id), isModified: true };
          if (updateMap.has(g.name)) return { ...g, ...updateMap.get(g.name), isModified: true };
          return g;
        });
      }

      if (localChanges.added && localChanges.added.length > 0) {
        updatedGames = [...localChanges.added, ...updatedGames];
      }

      return updatedGames;
    } catch (e) {
      console.error("로컬 변경사항 적용 실패:", e);
      return baseGames;
    }
  }

  /**
   * 게임 등록
   */
  async addGame(gameData) {
    const newGame = {
      id: `local_${Date.now()}`,
      rowIndex: null,
      name: gameData.name.trim(),
      minPlayers: gameData.minPlayers ? parseInt(gameData.minPlayers, 10) : null,
      maxPlayers: gameData.maxPlayers ? parseInt(gameData.maxPlayers, 10) : null,
      system: gameData.system ? gameData.system.trim() : '',
      notes: gameData.notes ? gameData.notes.trim() : '',
      bestPlayers: gameData.bestPlayers ? gameData.bestPlayers.trim() : '',
      difficulty: gameData.difficulty ? gameData.difficulty.trim() : '',
      owner: gameData.owner ? gameData.owner.trim() : '',
      isLocal: true,
      addedAt: new Date().toISOString()
    };

    if (this.settings.gasUrl && this.settings.gasUrl.trim().startsWith('https://script.google.com/')) {
      try {
        const payload = { action: 'add', ...newGame };
        await fetch(this.settings.gasUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload)
        });
      } catch (e) {
        console.warn('GAS 쓰기 실패 (로컬 스토리지에 백업):', e);
      }
    }

    const localChanges = this.getLocalChanges();
    localChanges.added = localChanges.added || [];
    localChanges.added.unshift(newGame);
    this.saveLocalChanges(localChanges);

    return newGame;
  }

  /**
   * 게임 정보 수정
   */
  async updateGame(gameData) {
    if (this.settings.gasUrl && this.settings.gasUrl.trim().startsWith('https://script.google.com/')) {
      try {
        const payload = { action: 'update', ...gameData };
        await fetch(this.settings.gasUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload)
        });
      } catch (e) {
        console.warn('GAS 수정 실패 (로컬에 저장):', e);
      }
    }

    const localChanges = this.getLocalChanges();
    localChanges.updated = localChanges.updated || [];
    localChanges.updated = localChanges.updated.filter(u => u.id !== gameData.id);
    localChanges.updated.push(gameData);
    this.saveLocalChanges(localChanges);

    return gameData;
  }

  /**
   * 게임 삭제
   */
  async deleteGame(game) {
    if (this.settings.gasUrl && this.settings.gasUrl.trim().startsWith('https://script.google.com/')) {
      try {
        const payload = { action: 'delete', rowIndex: game.rowIndex, name: game.name };
        await fetch(this.settings.gasUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload)
        });
      } catch (e) {
        console.warn('GAS 삭제 실패 (로컬에 반영):', e);
      }
    }

    const localChanges = this.getLocalChanges();
    localChanges.deleted = localChanges.deleted || [];
    if (!localChanges.deleted.includes(game.id)) {
      localChanges.deleted.push(game.id);
    }
    if (localChanges.added) {
      localChanges.added = localChanges.added.filter(g => g.id !== game.id);
    }
    this.saveLocalChanges(localChanges);
  }

  getLocalChanges() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY_LOCAL_CHANGES)) || {};
    } catch {
      return {};
    }
  }

  saveLocalChanges(changes) {
    localStorage.setItem(STORAGE_KEY_LOCAL_CHANGES, JSON.stringify(changes));
  }

  clearLocalChanges() {
    localStorage.removeItem(STORAGE_KEY_LOCAL_CHANGES);
  }

  exportToCSV(games) {
    const headers = ['게임명', '최소인원', '최대인원', '게임시스템', '비고', '베스트인원(주관적)', '난이도', '소유자'];
    const escapeField = (val) => {
      if (val === null || val === undefined) return '';
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const rows = [
      headers.join(','),
      ...games.map(g => [
        escapeField(g.name),
        escapeField(g.minPlayers),
        escapeField(g.maxPlayers),
        escapeField(g.system),
        escapeField(g.notes),
        escapeField(g.bestPlayers),
        escapeField(g.difficulty),
        escapeField(g.owner)
      ].join(','))
    ];

    return '\uFEFF' + rows.join('\r\n');
  }
}

window.SheetsService = SheetsService;
