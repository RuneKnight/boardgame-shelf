import { test, expect } from '@playwright/test';

test('Phase 1 PWA, Companion Tool, and Filters Verification', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', exception => pageErrors.push(exception));

  await page.goto('http://localhost:8080');
  await page.waitForTimeout(1000);

  // 1. Console / Page Error Check
  expect(pageErrors).toEqual([]);

  // 2. Play Tool Modal Test
  await page.click('button:has-text("플레이 툴")');
  await page.waitForSelector('text=테이블탑 플레이 보조 툴');

  // Test Score Calculator
  await page.click('button:has-text("+ 플레이어 추가")');
  const playerInputs = await page.$$('input[placeholder="이름"]');
  expect(playerInputs.length).toBeGreaterThanOrEqual(3);

  // Test Timer Tab
  await page.click('button:has-text("플레이 타이머")');
  await page.click('button:has-text("시작")');
  await page.waitForTimeout(1500);
  await page.click('button:has-text("일시정지")');

  // Test First Player Roulette
  await page.click('button:has-text("선 결정 룰렛")');
  await page.click('button:has-text("선 플레이어 뽑기!")');
  await page.waitForTimeout(1500);

  // Close modal
  await page.click('button:has-text("닫기")');

  // 3. Playtime Filter Test
  await page.click('button:has-text("⚡ Quick (≤30분)")');
  await page.waitForTimeout(500);

  // Take Screenshot
  await page.screenshot({ path: 'phase1_verification.png', fullPage: true });
});
