import { test, expect } from '@playwright/test';

test('Phase 2 BGG Import, Lineup, and Dashboard Verification', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', exception => pageErrors.push(exception));

  await page.goto('http://localhost:8080');
  await page.waitForTimeout(1000);

  // 1. Check page errors
  expect(pageErrors).toEqual([]);

  // 2. Test BGG Import Modal
  await page.click('button:has-text("BGG 연동")');
  await page.waitForSelector('text=BGG 마이 컬렉션 가져오기');
  await page.click('button:has-text("닫기")');

  // 3. Test Lineup Modal
  await page.click('button:has-text("맞춤 라인업")');
  await page.waitForSelector('text=모임 맞춤 게임 조율 라인업');
  await page.click('button:has-text("닫기")');

  // 4. Test Dashboard Modal
  await page.click('button:has-text("대시보드")');
  await page.waitForSelector('text=컬렉션 시각화 대시보드');
  await page.waitForTimeout(1000); // Allow Chart.js to render

  // Take screenshot of dashboard
  await page.screenshot({ path: 'phase2_verification.png', fullPage: true });

  await page.click('button:has-text("닫기")');
});
