/**
 * App.js: 메인 Vue 3 애플리케이션
 */

const { createApp, ref, computed, onMounted, watch } = Vue;

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

createApp({
  setup() {
    const sheetsService = new SheetsService();
    const bggService = new BGGService(sheetsService);

    // 상태
    const games = ref([]);
    const loading = ref(true);
    const refreshing = ref(false);
    const error = ref(null);
    const darkMode = ref(localStorage.getItem('bg_dark_mode') === 'true');

    // 필터 및 정렬
    const searchQuery = ref('');
    const selectedPlayerCount = ref('ALL'); // 'ALL', 1, 2, 3, 4, 5, 6, 7
    const selectedDifficulty = ref('ALL'); // 'ALL', '입문', '하', '중하', '중', '상'
    const selectedOwner = ref('ALL');
    const selectedSystem = ref('ALL');
    const sortBy = ref('name_asc'); // 'name_asc', 'name_desc', 'diff_asc', 'diff_desc', 'player_asc'
    const viewMode = ref(localStorage.getItem('bg_view_mode') || 'card'); // 'card' or 'table'

    // 페이지네이션
    const currentPage = ref(1);
    const pageSize = ref(36);

    // 모달 상태
    const isDetailModalOpen = ref(false);
    const activeGame = ref(null);

    const isEditModalOpen = ref(false);
    const isEditing = ref(false); // true: 수정, false: 신규 등록
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

    // BGG 검색 모달
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

    // 랜덤 추천 모달 ("오늘 뭐 하지?")
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

    // 소유자 목록 추출 (가장 많은 소유자 순)
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

    // 시스템 목록 추출 (자주 등장하는 순)
    const systemsList = computed(() => {
      const counts = {};
      games.value.forEach(g => {
        if (!g.system) return;
        const systems = g.system.split(/[,/]/).map(s => s.trim()).filter(Boolean);
        systems.forEach(s => {
          counts[s] = (counts[s] || 0) + 1;
        });
      });
      return Object.entries(counts)
        .filter(([_, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count }));
    });

    // 필터링 및 정렬된 게임 목록
    const filteredGames = computed(() => {
      let result = [...games.value];

      // 1. 검색어 필터 (게임명, 초성, 시스템, 비고, 소유자)
      if (searchQuery.value.trim()) {
        const q = searchQuery.value.trim().toLowerCase();
        const isQueryChosung = /^[ㄱ-ㅎ]+$/.test(q);

        result = result.filter(g => {
          const name = (g.name || '').toLowerCase();
          const system = (g.system || '').toLowerCase();
          const notes = (g.notes || '').toLowerCase();
          const owner = (g.owner || '').toLowerCase();

          // 초성 검색
          if (isQueryChosung) {
            const chosung = getChosung(g.name);
            if (chosung.includes(q)) return true;
          }

          return name.includes(q) || system.includes(q) || notes.includes(q) || owner.includes(q);
        });
      }

      // 2. 인원수 필터
      if (selectedPlayerCount.value !== 'ALL') {
        const count = parseInt(selectedPlayerCount.value, 10);
        result = result.filter(g => {
          const min = g.minPlayers;
          const max = g.maxPlayers;
          if (min === null && max === null) return true; // 인원 미기재 게임은 표시
          if (min !== null && count < min) return false;
          if (max !== null && count > max) return false;
          return true;
        });
      }

      // 3. 난이도 필터
      if (selectedDifficulty.value !== 'ALL') {
        result = result.filter(g => {
          const diff = (g.difficulty || '').trim();
          if (selectedDifficulty.value === '하') {
            return diff === '하' || diff === '초급';
          }
          return diff === selectedDifficulty.value;
        });
      }

      // 4. 소유자 필터
      if (selectedOwner.value !== 'ALL') {
        result = result.filter(g => (g.owner || '').includes(selectedOwner.value));
      }

      // 5. 시스템 필터
      if (selectedSystem.value !== 'ALL') {
        result = result.filter(g => (g.system || '').includes(selectedSystem.value));
      }

      // 6. 정렬
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

    // 페이지네이션 적용된 게임 목록
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

    // 필터 변경 시 페이지 리셋
    watch([searchQuery, selectedPlayerCount, selectedDifficulty, selectedOwner, selectedSystem, sortBy], () => {
      currentPage.value = 1;
    });

    // 베스트 인원 매칭 여부 검사
    const isBestPlayerMatch = (game, targetCount) => {
      if (!game.bestPlayers || targetCount === 'ALL') return false;
      const best = game.bestPlayers.toString();
      const countStr = targetCount.toString();
      return best.includes(countStr);
    };

    // 상세 모달 열기
    const openDetailModal = (game) => {
      activeGame.value = game;
      isDetailModalOpen.value = true;
    };

    // 추가 모달 열기
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

    // 수정 모달 열기
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

    // 게임 저장 (신규 또는 수정)
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

    // 게임 삭제
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

    // BGG 검색 열기
    const openBggSearch = () => {
      bggQuery.value = editForm.value.name || '';
      bggResults.value = [];
      bggSelectedDetail.value = null;
      isBggModalOpen.value = true;
      if (bggQuery.value.trim()) {
        searchBgg();
      }
    };

    // BGG 검색 실행
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

    // BGG 상세 정보 조회 및 폼 자동 반영
    const selectBggGame = async (bggId) => {
      bggLoading.value = true;
      try {
        const detail = await bggService.getGameDetails(bggId);
        bggSelectedDetail.value = detail;

        // 폼에 자동 반영
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

    // 설정 열기
    const openSettingsModal = () => {
      const current = sheetsService.settings;
      settingsForm.value = {
        csvUrl: current.csvUrl || '',
        gasUrl: current.gasUrl || '',
        bggToken: current.bggToken || ''
      };
      isSettingsModalOpen.value = true;
    };

    // 설정 저장
    const saveSettings = () => {
      sheetsService.saveSettings(settingsForm.value);
      showToast('설정이 저장되었습니다.', 'success');
      isSettingsModalOpen.value = false;
      loadData(true);
    };

    // CSV 다운로드
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

    // CSV 파일 직접 업로드 동기화
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
      e.target.value = ''; // 초기화
    };

    // 로컬 변경사항 초기화
    const resetLocalData = () => {
      if (!confirm('로컬에 임시 저장된 변경 사항을 모두 삭제하고 초기 원본으로 되돌릴까요?')) return;
      sheetsService.clearLocalChanges();
      loadData(true);
      showToast('초기화되었습니다.', 'info');
      isSettingsModalOpen.value = false;
    };

    // 랜덤 게임 추천 ("오늘 뭐 하지?")
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
      loadData();
    });

    return {
      games,
      loading,
      refreshing,
      error,
      darkMode,
      toggleDarkMode,
      searchQuery,
      selectedPlayerCount,
      selectedDifficulty,
      selectedOwner,
      selectedSystem,
      sortBy,
      viewMode,
      setViewMode,
      ownersList,
      systemsList,
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
      toast
    };
  }
}).mount('#app');
