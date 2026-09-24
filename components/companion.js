/**
 * components/companion.js: 테이블탑 플레이 보조 툴 컴포넌트 로직
 */

export function setupCompanionTool(ref, computed) {
  const isCompanionModalOpen = ref(false);
  const companionTab = ref('score'); // 'score', 'timer', 'firstPlayer'

  // 1. 점수 계산기
  const scorePlayers = ref([
    { name: '플레이어 1', score: 0 },
    { name: '플레이어 2', score: 0 }
  ]);

  const addScorePlayer = () => {
    scorePlayers.value.push({ name: `플레이어 ${scorePlayers.value.length + 1}`, score: 0 });
  };

  const removeScorePlayer = (idx) => {
    if (scorePlayers.value.length > 1) {
      scorePlayers.value.splice(idx, 1);
    }
  };

  const maxScore = computed(() => {
    if (scorePlayers.value.length === 0) return -Infinity;
    return Math.max(...scorePlayers.value.map(p => Number(p.score) || 0));
  });

  const isWinnerPlayer = (p) => {
    const s = Number(p.score) || 0;
    return s > 0 && s === maxScore.value;
  };

  const winningPlayerName = computed(() => {
    const winners = scorePlayers.value.filter(p => isWinnerPlayer(p));
    if (winners.length === 0) return '';
    return winners.map(w => w.name).join(', ');
  });

  // 2. 플레이 타이머
  const timerSeconds = ref(0);
  const isTimerRunning = ref(false);
  let timerInterval = null;

  const startTimer = () => {
    if (isTimerRunning.value) return;
    isTimerRunning.value = true;
    timerInterval = setInterval(() => {
      timerSeconds.value++;
    }, 1000);
  };

  const pauseTimer = () => {
    isTimerRunning.value = false;
    if (timerInterval) clearInterval(timerInterval);
  };

  const resetTimer = () => {
    pauseTimer();
    timerSeconds.value = 0;
  };

  const formatTimer = (totalSec) => {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  };

  // 3. 선 플레이어 룰렛
  const fpNamesInput = ref('명수, 인철, 현정, 구슬');
  const fpPickedWinner = ref('');
  const isFpSpinning = ref(false);

  const spinFirstPlayer = (showToast) => {
    const names = fpNamesInput.value.split(/[,/]/).map(n => n.trim()).filter(Boolean);
    if (names.length === 0) {
      if (showToast) showToast('플레이어 이름을 1명 이상 입력해주세요.', 'error');
      return;
    }
    isFpSpinning.value = true;
    let count = 0;
    const interval = setInterval(() => {
      const idx = Math.floor(Math.random() * names.length);
      fpPickedWinner.value = names[idx];
      count++;
      if (count > 20) {
        clearInterval(interval);
        isFpSpinning.value = false;
      }
    }, 60);
  };

  const openCompanionModal = () => {
    isCompanionModalOpen.value = true;
  };

  return {
    isCompanionModalOpen,
    companionTab,
    openCompanionModal,
    scorePlayers,
    addScorePlayer,
    removeScorePlayer,
    isWinnerPlayer,
    winningPlayerName,
    timerSeconds,
    isTimerRunning,
    startTimer,
    pauseTimer,
    resetTimer,
    formatTimer,
    fpNamesInput,
    fpPickedWinner,
    isFpSpinning,
    spinFirstPlayer
  };
}
