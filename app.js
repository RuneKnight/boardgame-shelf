/**
 * App.js: 메인 Vue 3 애플리케이션 (PWA, 컴패니언 툴, 다중 태그/시간 필터, BGG 연동, 대시보드, AI 모듈 연동)
 */

import { setupCompanionTool } from './components/companion.js';
import { setupDashboard } from './components/dashboard.js';
import { recommendGamesByAiPrompt } from './services/ai.js';

const { createApp, ref, computed, onMounted, watch, nextTick } = Vue;

const CHOSUNG = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
function getChosung(str) {
  if (!str) return "";
  let result = "";
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i) - 44032;
    if (code >= 0 && code <= 11171) {
      result += CHOSUNG[Math.floor(code / 588)];
    } else {
      result += str[i];
    }
  }
  return result;
}

const DIFFICULTY_ORDER = {
  '입문': 1,
  '초급': 2,
  '하': 2,
  '중하': 3,
  '중': 4,
  '상': 5
};

function parseGamePlayTime(game) {
  if (!game) return null;
  const text = `${game.notes || ''} ${game.system || ''}`;
  const match = text.match(/(?:플레이시간:?|시간:?|\b)(\d+)\s*분/);
  if (match) {
    return parseInt(match[1], 10);
  }
  const diff = (game.difficulty || '').trim();
  if (diff === '입문') return 20;
  if (diff === '하' || diff === '초급') return 30;
  if (diff === '중하') return 45;
  if (diff === '중') return 75;
  if (diff === '상') return 120;
  return 45;
}

createApp({
  setup() {
    const sheetsService = new SheetsService();
    const bggService = new BGGService(sheetsService);

    // 기본 상태
    const games = ref([]);
    const loading = ref(true);
    const refreshing = ref(false);
    const error = ref(null);
    const darkMode = ref(localStorage.getItem('bg_dark_mode') === 'true');

    // PWA 상태
    const deferredPwaPrompt = ref(null);
    const isPwaModalOpen = ref(false);

    // 필터 및 정렬
    const searchQuery = ref('');
    const selectedPlayerCount = ref('ALL');
    const selectedPlayTime = ref('ALL');
    const selectedDifficulty = ref('ALL');
    const selectedOwner = ref('ALL');
    const selectedTags = ref([]);
    const tagMatchMode = ref('OR');
    const sortBy = ref('name_asc');
    const viewMode = ref(localStorage.getItem('bg_view_mode') || 'card');

    // 페이지네이션
    const currentPage = ref(1);
    const pageSize = ref(36);

    // 모달 상태
    const isDetailModalOpen = ref(false);
    const activeGame = ref(null);

    const isEditModalOpen = ref(false);
    const isEditing = ref(false);
    const editForm = ref({
      id: '',
      rowIndex: null,
      name: '',
      minPlayers: '',
      maxPlayers: '',
      system: '',
      notes: '',
      bestPlayers: '',
      difficulty: '',
      owner: ''
    });

    // BGG 단일 검색 모달
    const isBggModalOpen = ref(false);
    const bggQuery = ref('');
    const bggLoading = ref(false);
    const bggResults = ref([]);
    const bggSelectedDetail = ref(null);

    // 설정 모달
    const isSettingsModalOpen = ref(false);
    const settingsForm = ref({
      csvUrl: '',
      gasUrl: '',
      bggToken: ''
    });

    // 랜덤 추천 모달
    const isRandomModalOpen = ref(false);
    const randomPickedGame = ref(null);
    const isSpinning = ref(false);

    // 토스트 알림
    const toast = ref({ show: false, message: '', type: 'info' });
    const showToast = (message, type = 'info') => {
      toast.value = { show: true, message, type };
      setTimeout(() => {
        toast.value.show = false;
      }, 3000);
    };

    // [Phase 1 Component] 🎲 플레이 보조 툴 (Companion Component)
    const companionLogic = setupCompanionTool(ref, computed);

    // [Phase 2 Component] 📊 시각화 대시보드 (Dashboard Component)
    const dashboardLogic = setupDashboard(ref, nextTick, games);

    // [Phase 2] 📥 BGG 마이 컬렉션 연동 (2.1)
    const isBggImportModalOpen = ref(false);
    const bggUsernameInput = ref('');
    const bggImportOwn = ref(true);
    const bggImportWish = ref(false);
    const bggImportLoading = ref(false);

    const openBggImportModal = () => {
      isBggImportModalOpen.value = true;
    };

    const importBggUserCollection = async () => {
      if (!bggUsernameInput.value.trim()) {
        showToast('BGG 계정 ID를 입력하세요.', 'error');
        return;
      }
      bggImportLoading.value = true;
      try {
        const username = bggUsernameInput.value.trim();
        let fetchedGames = [];

        if (bggImportOwn.value) {
          const ownGames = await bggService.getUserCollection(username, 'own');
          fetchedGames.push(...ownGames);
        }
        if (bggImportWish.value) {
          const wishGames = await bggService.getUserCollection(username, 'wishlist');
          fetchedGames.push(...wishGames);
        }

        if (fetchedGames.length === 0) {
          showToast('불러올 BGG 컬렉션 게임이 없습니다.', 'info');
        } else {
          for (const g of fetchedGames) {
            await sheetsService.addGame(g);
          }
          await loadData(false);
          showToast(`BGG에서 ${fetchedGames.length}개 게임을 내 선반에 추가했습니다!`, 'success');
          isBggImportModalOpen.value = false;
        }
      } catch (err) {
        showToast(`BGG 컬렉션 가져오기 실패: ${err.message}`, 'error');
      } finally {
        bggImportLoading.value = false;
      }
    };

    // [Phase 2] 🎯 모임 맞춤 라인업 조율 (2.2)
    const isLineupModalOpen = ref(false);
    const lineupPlayers = ref(4);
    const lineupTotalTime = ref(180);

    const openLineupModal = () => {
      isLineupModalOpen.value = true;
    };

    const lineupPackages = computed(() => {
      const players = lineupPlayers.value || 4;
      const targetTime = lineupTotalTime.value || 180;

      const matchedGames = games.value.filter(g => {
        const min = g.minPlayers;
        const max = g.maxPlayers;
        if (min !== null && players < min) return false;
        if (max !== null && players > max) return false;
        return true;
      });

      if (matchedGames.length === 0) return [];

      const list1 = [...matchedGames].sort(() => 0.5 - Math.random());
      const pkg1 = [];
      let timeAcc1 = 0;
      for (const g of list1) {
        const t = parseGamePlayTime(g) || 45;
        if (timeAcc1 + t <= targetTime + 30) {
          pkg1.push(g);
          timeAcc1 += t;
        }
        if (pkg1.length >= 3 || timeAcc1 >= targetTime - 20) break;
      }

      const list2 = [...matchedGames].sort(() => 0.5 - Math.random());
      const pkg2 = [];
      let timeAcc2 = 0;
      for (const g of list2) {
        const t = parseGamePlayTime(g) || 45;
        if (timeAcc2 + t <= targetTime + 30 && !pkg1.some(p => p.id === g.id)) {
          pkg2.push(g);
          timeAcc2 += t;
        }
        if (pkg2.length >= 3 || timeAcc2 >= targetTime - 20) break;
      }

      const packages = [];
      if (pkg1.length > 0) {
        packages.push({
          title: '알찬 몰입형 조합',
          games: pkg1,
          totalEstimatedTime: timeAcc1
        });
      }
      if (pkg2.length > 0) {
        packages.push({
          title: '다채로운 파티 & 메인 조합',
          games: pkg2,
          totalEstimatedTime: timeAcc2
        });
      }
      return packages;
    });

    // [Phase 3 Service] 🤖 AI 추천 엔진
    const isAiModalOpen = ref(false);
    const aiPromptInput = ref('');
    const isAiThinking = ref(false);
    const aiRecommendations = ref([]);

    const openAiModal = () => {
      isAiModalOpen.value = true;
    };

    const runAiRecommendation = () => {
      if (!aiPromptInput.value.trim()) {
        showToast('원하는 모임 상황이나 조건을 입력해주세요.', 'error');
        return;
      }
      isAiThinking.value = true;
      aiRecommendations.value = [];

      setTimeout(() => {
        aiRecommendations.value = recommendGamesByAiPrompt(aiPromptInput.value, games.value);
        isAiThinking.value = false;
      }, 500);
    };

    // 다크모드 토글
    const toggleDarkMode = () => {
      darkMode.value = !darkMode.value;
      localStorage.setItem('bg_dark_mode', darkMode.value);
      if (darkMode.value) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    };

    // 뷰 모드 변경
    const setViewMode = (mode) => {
      viewMode.value = mode;
      localStorage.setItem('bg_view_mode', mode);
    };

    // PWA 설치 버튼
    const showPwaInstallBtn = computed(() => {
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
      return !isStandalone;
    });

    const triggerPwaInstall = () => {
      if (deferredPwaPrompt.value) {
        deferredPwaPrompt.value.prompt();
        deferredPwaPrompt.value.userChoice.then((choiceResult) => {
          if (choiceResult.outcome === 'accepted') {
            showToast('보드게임 매니저 앱이 설치되었습니다!', 'success');
          }
          deferredPwaPrompt.value = null;
        });
      } else {
        isPwaModalOpen.value = true;
      }
    };

    const triggerPwaPromptAction = () => {
      if (deferredPwaPrompt.value) {
        triggerPwaInstall();
      }
    };

    // 데이터 로드
    const loadData = async (force = false) => {
      try {
        if (force) refreshing.value = true;
        else loading.value = true;
        error.value = null;

        const data = await sheetsService.fetchGames(force);
        games.value = data;
        if (force) {
          showToast(`최신 목록을 불러왔습니다 (${data.length}개 게임)`, 'success');
        }
      } catch (err) {
        error.value = err.message;
        showToast(`데이터 로드 실패: ${err.message}`, 'error');
      } finally {
        loading.value = false;
        refreshing.value = false;
      }
    };

    // 소유자 목록
    const ownersList = computed(() => {
      const counts = {};
      games.value.forEach(g => {
        if (!g.owner) return;
        const owners = g.owner.split(/[,/]/).map(o => o.trim()).filter(Boolean);
        owners.forEach(o => {
          counts[o] = (counts[o] || 0) + 1;
        });
      });
      return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count }));
    });

    // 전체 시스템/메커니즘 태그 목록
    const allSystems = computed(() => {
      const counts = {};
      games.value.forEach(g => {
        if (!g.system) return;
        const systems = g.system.split(/[,/]/).map(s => s.trim()).filter(Boolean);
        systems.forEach(s => {
          counts[s] = (counts[s] || 0) + 1;
        });
      });
      return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count }));
    });

    const toggleTag = (tagName) => {
      const idx = selectedTags.value.indexOf(tagName);
      if (idx >= 0) {
        selectedTags.value.splice(idx, 1);
      } else {
        selectedTags.value.push(tagName);
      }
    };

    const resetAllFilters = () => {
      searchQuery.value = '';
      selectedPlayerCount.value = 'ALL';
      selectedPlayTime.value = 'ALL';
      selectedDifficulty.value = 'ALL';
      selectedOwner.value = 'ALL';
      selectedTags.value = [];
    };

    const getGamePlayTime = (game) => {
      return parseGamePlayTime(game);
    };

    // 필터링 및 정렬된 게임 목록
    const filteredGames = computed(() => {
      let result = [...games.value];

      if (searchQuery.value.trim()) {
        const q = searchQuery.value.trim().toLowerCase();
        const isQueryChosung = /^[ㄱ-ㅎ]+$/.test(q);

        result = result.filter(g => {
          const name = (g.name || '').toLowerCase();
          const system = (g.system || '').toLowerCase();
          const notes = (g.notes || '').toLowerCase();
          const owner = (g.owner || '').toLowerCase();

          if (isQueryChosung) {
            const chosung = getChosung(g.name);
            if (chosung.includes(q)) return true;
          }

          return name.includes(q) || system.includes(q) || notes.includes(q) || owner.includes(q);
        });
      }

      if (selectedPlayerCount.value !== 'ALL') {
        const count = parseInt(selectedPlayerCount.value, 10);
        result = result.filter(g => {
          const min = g.minPlayers;
          const max = g.maxPlayers;
          if (min === null && max === null) return true;
          if (min !== null && count < min) return false;
          if (max !== null && count > max) return false;
          return true;
        });
      }

      if (selectedPlayTime.value !== 'ALL') {
        result = result.filter(g => {
          const t = parseGamePlayTime(g);
          if (!t) return true;
          if (selectedPlayTime.value === 'Quick') return t <= 30;
          if (selectedPlayTime.value === 'Mid') return t > 30 && t <= 60;
          if (selectedPlayTime.value === 'Heavy') return t >= 120;
          return true;
        });
      }

      if (selectedDifficulty.value !== 'ALL') {
        result = result.filter(g => {
          const diff = (g.difficulty || '').trim();
          if (selectedDifficulty.value === '하') {
            return diff === '하' || diff === '초급';
          }
          return diff === selectedDifficulty.value;
        });
      }

      if (selectedOwner.value !== 'ALL') {
        result = result.filter(g => (g.owner || '').includes(selectedOwner.value));
      }

      if (selectedTags.value.length > 0) {
        result = result.filter(g => {
          const gameSys = (g.system || '').toLowerCase();
          if (tagMatchMode.value === 'AND') {
            return selectedTags.value.every(tag => gameSys.includes(tag.toLowerCase()));
          } else {
            return selectedTags.value.some(tag => gameSys.includes(tag.toLowerCase()));
          }
        });
      }

      result.sort((a, b) => {
        if (sortBy.value === 'name_asc') {
          return a.name.localeCompare(b.name, 'ko');
        } else if (sortBy.value === 'name_desc') {
          return b.name.localeCompare(a.name, 'ko');
        } else if (sortBy.value === 'diff_asc') {
          const diffA = DIFFICULTY_ORDER[a.difficulty] || 99;
          const diffB = DIFFICULTY_ORDER[b.difficulty] || 99;
          return diffA - diffB;
        } else if (sortBy.value === 'diff_desc') {
          const diffA = DIFFICULTY_ORDER[a.difficulty] || 0;
          const diffB = DIFFICULTY_ORDER[b.difficulty] || 0;
          return diffB - diffA;
        } else if (sortBy.value === 'player_asc') {
          return (a.minPlayers || 0) - (b.minPlayers || 0);
        }
        return 0;
      });

      return result;
    });

    const paginatedGames = computed(() => {
      const start = 0;
      const end = currentPage.value * pageSize.value;
      return filteredGames.value.slice(start, end);
    });

    const hasMoreGames = computed(() => {
      return paginatedGames.value.length < filteredGames.value.length;
    });

    const loadMore = () => {
      currentPage.value++;
    };

    watch([searchQuery, selectedPlayerCount, selectedPlayTime, selectedDifficulty, selectedOwner, selectedTags, tagMatchMode, sortBy], () => {
      currentPage.value = 1;
    });

    const isBestPlayerMatch = (game, targetCount) => {
      if (!game.bestPlayers || targetCount === 'ALL') return false;
      const best = game.bestPlayers.toString();
      const countStr = targetCount.toString();
      return best.includes(countStr);
    };

    const openDetailModal = (game) => {
      activeGame.value = game;
      isDetailModalOpen.value = true;
    };

    const openAddModal = () => {
      isEditing.value = false;
      editForm.value = {
        id: '',
        rowIndex: null,
        name: '',
        minPlayers: '',
        maxPlayers: '',
        system: '',
        notes: '',
        bestPlayers: '',
        difficulty: '',
        owner: ''
      };
      isEditModalOpen.value = true;
    };

    const openEditModal = (game) => {
      isEditing.value = true;
      editForm.value = {
        id: game.id,
        rowIndex: game.rowIndex,
        name: game.name,
        minPlayers: game.minPlayers !== null ? game.minPlayers : '',
        maxPlayers: game.maxPlayers !== null ? game.maxPlayers : '',
        system: game.system || '',
        notes: game.notes || '',
        bestPlayers: game.bestPlayers || '',
        difficulty: game.difficulty || '',
        owner: game.owner || ''
      };
      isDetailModalOpen.value = false;
      isEditModalOpen.value = true;
    };

    const saveGame = async () => {
      if (!editForm.value.name.trim()) {
        showToast('게임명을 입력해주세요.', 'error');
        return;
      }

      try {
        if (isEditing.value) {
          await sheetsService.updateGame(editForm.value);
          showToast(`'${editForm.value.name}' 정보가 수정되었습니다.`, 'success');
        } else {
          await sheetsService.addGame(editForm.value);
          showToast(`'${editForm.value.name}' 게임이 등록되었습니다.`, 'success');
        }
        isEditModalOpen.value = false;
        await loadData(false);
      } catch (e) {
        showToast(`저장 실패: ${e.message}`, 'error');
      }
    };

    const deleteGame = async (game) => {
      if (!confirm(`'${game.name}' 게임을 정말 삭제하시겠습니까?`)) return;

      try {
        await sheetsService.deleteGame(game);
        showToast(`'${game.name}' 게임이 삭제되었습니다.`, 'success');
        isDetailModalOpen.value = false;
        await loadData(false);
      } catch (e) {
        showToast(`삭제 실패: ${e.message}`, 'error');
      }
    };

    const openBggSearch = () => {
      bggQuery.value = editForm.value.name || '';
      bggResults.value = [];
      bggSelectedDetail.value = null;
      isBggModalOpen.value = true;
      if (bggQuery.value.trim()) {
        searchBgg();
      }
    };

    const searchBgg = async () => {
      if (!bggQuery.value.trim()) return;
      bggLoading.value = true;
      bggResults.value = [];
      try {
        const results = await bggService.searchGames(bggQuery.value);
        bggResults.value = results;
        if (results.length === 0) {
          showToast('검색 결과가 없습니다. 영문 이름으로 검색해보세요.', 'info');
        }
      } catch (err) {
        showToast(`BGG 검색 오류: ${err.message}`, 'error');
      } finally {
        bggLoading.value = false;
      }
    };

    const selectBggGame = async (bggId) => {
      bggLoading.value = true;
      try {
        const detail = await bggService.getGameDetails(bggId);
        bggSelectedDetail.value = detail;

        if (detail.name) editForm.value.name = detail.name;
        if (detail.minPlayers) editForm.value.minPlayers = detail.minPlayers;
        if (detail.maxPlayers) editForm.value.maxPlayers = detail.maxPlayers;
        if (detail.bestPlayers) editForm.value.bestPlayers = detail.bestPlayers;
        if (detail.difficulty) editForm.value.difficulty = detail.difficulty;
        if (detail.system) editForm.value.system = detail.system;

        let noteAdd = [];
        if (detail.englishName && detail.englishName !== detail.name) {
          noteAdd.push(`원제: ${detail.englishName}`);
        }
        if (detail.bggRating) noteAdd.push(`BGG 평점: ${detail.bggRating}`);
        if (detail.bggWeight) noteAdd.push(`웨이트: ${detail.bggWeight}`);
        if (detail.playTime) noteAdd.push(`플레이시간: ${detail.playTime}`);

        if (noteAdd.length > 0) {
          editForm.value.notes = editForm.value.notes 
            ? `${editForm.value.notes} / ${noteAdd.join(', ')}` 
            : noteAdd.join(', ');
        }

        showToast(`'${detail.name}' 정보가 폼에 자동 입력되었습니다!`, 'success');
        isBggModalOpen.value = false;
      } catch (err) {
        showToast(`상세 정보 가져오기 실패: ${err.message}`, 'error');
      } finally {
        bggLoading.value = false;
      }
    };

    const openSettingsModal = () => {
      const current = sheetsService.settings;
      settingsForm.value = {
        csvUrl: current.csvUrl || '',
        gasUrl: current.gasUrl || '',
        bggToken: current.bggToken || ''
      };
      isSettingsModalOpen.value = true;
    };

    const saveSettings = () => {
      sheetsService.saveSettings(settingsForm.value);
      showToast('설정이 저장되었습니다.', 'success');
      isSettingsModalOpen.value = false;
      loadData(true);
    };

    const exportCSV = () => {
      const csvData = sheetsService.exportToCSV(games.value);
      const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `boardgames_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast('CSV 파일이 다운로드되었습니다.', 'success');
    };

    const handleCsvUpload = (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const content = event.target.result;
          const imported = sheetsService.importCsvText(content);
          games.value = imported;
          showToast(`CSV 파일에서 ${imported.length}개 게임을 성공적으로 불러왔습니다!`, 'success');
          isSettingsModalOpen.value = false;
        } catch (err) {
          showToast(`CSV 파싱 실패: ${err.message}`, 'error');
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    };

    const resetLocalData = () => {
      if (!confirm('로컬에 임시 저장된 변경 사항을 모두 삭제하고 초기 원본으로 되돌릴까요?')) return;
      sheetsService.clearLocalChanges();
      loadData(true);
      showToast('초기화되었습니다.', 'info');
      isSettingsModalOpen.value = false;
    };

    const openRandomPicker = () => {
      if (filteredGames.value.length === 0) {
        showToast('조건에 맞는 게임이 없습니다.', 'error');
        return;
      }
      isRandomModalOpen.value = true;
      spinRandomGame();
    };

    const spinRandomGame = () => {
      isSpinning.value = true;
      let count = 0;
      const list = filteredGames.value;
      const interval = setInterval(() => {
        const randomIndex = Math.floor(Math.random() * list.length);
        randomPickedGame.value = list[randomIndex];
        count++;
        if (count > 15) {
          clearInterval(interval);
          isSpinning.value = false;
        }
      }, 70);
    };

    onMounted(() => {
      if (darkMode.value) {
        document.documentElement.classList.add('dark');
      }

      window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPwaPrompt.value = e;
      });

      loadData();
    });

    return {
      games,
      loading,
      refreshing,
      error,
      darkMode,
      toggleDarkMode,
      showPwaInstallBtn,
      deferredPwaPrompt,
      isPwaModalOpen,
      triggerPwaInstall,
      triggerPwaPromptAction,
      searchQuery,
      selectedPlayerCount,
      selectedPlayTime,
      selectedDifficulty,
      selectedOwner,
      selectedTags,
      tagMatchMode,
      sortBy,
      viewMode,
      setViewMode,
      ownersList,
      allSystems,
      toggleTag,
      resetAllFilters,
      getGamePlayTime,
      filteredGames,
      paginatedGames,
      hasMoreGames,
      loadMore,
      isBestPlayerMatch,
      loadData,
      isDetailModalOpen,
      activeGame,
      openDetailModal,
      isEditModalOpen,
      isEditing,
      editForm,
      openAddModal,
      openEditModal,
      saveGame,
      deleteGame,
      isBggModalOpen,
      bggQuery,
      bggLoading,
      bggResults,
      openBggSearch,
      searchBgg,
      selectBggGame,
      isSettingsModalOpen,
      settingsForm,
      openSettingsModal,
      saveSettings,
      exportCSV,
      handleCsvUpload,
      resetLocalData,
      isRandomModalOpen,
      randomPickedGame,
      isSpinning,
      openRandomPicker,
      spinRandomGame,
      // Companion component logic
      ...companionLogic,
      // Dashboard component logic
      ...dashboardLogic,
      // BGG Import
      isBggImportModalOpen,
      bggUsernameInput,
      bggImportOwn,
      bggImportWish,
      bggImportLoading,
      openBggImportModal,
      importBggUserCollection,
      // Lineup
      isLineupModalOpen,
      lineupPlayers,
      lineupTotalTime,
      openLineupModal,
      lineupPackages,
      // AI
      isAiModalOpen,
      aiPromptInput,
      isAiThinking,
      aiRecommendations,
      openAiModal,
      runAiRecommendation,
      toast
    };
  }
}).mount('#app');
