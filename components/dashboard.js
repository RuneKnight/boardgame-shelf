/**
 * components/dashboard.js: Chart.js 기반 시각화 대시보드 모듈
 */

export function setupDashboard(ref, nextTick, games) {
  const isDashboardModalOpen = ref(false);
  let diffChart = null;
  let systemChart = null;

  const openDashboardModal = () => {
    isDashboardModalOpen.value = true;
    nextTick(() => {
      renderCharts();
    });
  };

  const renderCharts = () => {
    const diffCanvas = document.getElementById('diffChartCanvas');
    const systemCanvas = document.getElementById('systemChartCanvas');
    if (!diffCanvas || !systemCanvas || typeof Chart === 'undefined') return;

    if (diffChart) diffChart.destroy();
    if (systemChart) systemChart.destroy();

    // 난이도 카운트
    const diffCounts = { '입문': 0, '초급/하': 0, '중하': 0, '중': 0, '상': 0 };
    games.value.forEach(g => {
      const d = (g.difficulty || '').trim();
      if (d === '입문') diffCounts['입문']++;
      else if (d === '하' || d === '초급') diffCounts['초급/하']++;
      else if (d === '중하') diffCounts['중하']++;
      else if (d === '중') diffCounts['중']++;
      else if (d === '상') diffCounts['상']++;
    });

    diffChart = new Chart(diffCanvas, {
      type: 'doughnut',
      data: {
        labels: Object.keys(diffCounts),
        datasets: [{
          data: Object.values(diffCounts),
          backgroundColor: ['#38bdf8', '#34d399', '#facc15', '#fb923c', '#f87171']
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 10 } } } }
      }
    });

    // 메커니즘 Top 5 카운트
    const sysCounts = {};
    games.value.forEach(g => {
      if (!g.system) return;
      g.system.split(/[,/]/).forEach(s => {
        const key = s.trim();
        if (key) sysCounts[key] = (sysCounts[key] || 0) + 1;
      });
    });

    const topSystems = Object.entries(sysCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    systemChart = new Chart(systemCanvas, {
      type: 'bar',
      data: {
        labels: topSystems.map(t => t[0]),
        datasets: [{
          label: '보유 게임 수',
          data: topSystems.map(t => t[1]),
          backgroundColor: '#8b5cf6'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
      }
    });
  };

  return {
    isDashboardModalOpen,
    openDashboardModal,
    renderCharts
  };
}
