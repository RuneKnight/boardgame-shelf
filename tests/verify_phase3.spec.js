import { test, expect } from '@playwright/test';

test.describe('Phase 3 Verification Tests', () => {
  test('ES module script loads without error and AI recommendation works', async ({ page }) => {
    const jsErrors = [];
    page.on('pageerror', err => {
      jsErrors.push(err.message);
    });

    await page.goto('http://localhost:8080');
    await page.waitForSelector('#app', { state: 'visible' });

    // 1. Verify App loaded and title is visible
    const title = await page.textContent('h1');
    expect(title).toContain('보드게임 매니저');

    // 2. Open AI Recommendation Modal
    const aiBtn = page.locator('button[title="AI 자연어 추천"]');
    await expect(aiBtn).toBeVisible();
    await aiBtn.click();

    const aiModalTitle = page.locator('h3:has-text("AI 스마트 보드게임 추천")');
    await expect(aiModalTitle).toBeVisible();

    // 3. Fill in natural language prompt
    const promptArea = page.locator('textarea[placeholder*="입문자 2명"]');
    await promptArea.fill('입문자 2명이 즐길 쉬운 난이도 보드게임 추천해줘');

    // 4. Run AI Recommendation
    const runBtn = page.locator('button:has-text("AI 분석 & 매칭 게임 추천")');
    await runBtn.click();

    // 5. Check recommendation results
    const resultHeader = page.locator('span:has-text("AI가 선반에서 엄선한 추천 3선")');
    await expect(resultHeader).toBeVisible({ timeout: 5000 });

    const recCards = page.locator('.bg-gradient-to-r.from-sky-50');
    expect(await recCards.count()).toBeGreaterThan(0);

    // Take screenshot of AI recommendation modal
    await page.screenshot({ path: 'phase3_verification.png' });

    // 6. Ensure 0 JavaScript runtime errors
    expect(jsErrors).toEqual([]);
  });
});
