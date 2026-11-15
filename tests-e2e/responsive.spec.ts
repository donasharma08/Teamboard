import { expect, test } from '@playwright/test';

/** Layout check at phone, tablet and laptop widths: nothing should force sideways scrolling of the page. */
const widths = [375, 768, 1024, 1440];
const pages = ['/o/1/my-work', '/o/1/projects', '/o/1/projects/1', '/o/1/notifications', '/o/1/people', '/o/1/reports'];

for (const width of widths) {
  test(`no sideways page scroll at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.getByRole('button', { name: /Asha Rao/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Asha');
    for (const path of pages) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      // The Kanban board scrolls inside its own container on purpose; the page itself must not.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${path} overflows by ${overflow}px`).toBeLessThanOrEqual(1);
    }
  });
}

test('reports explain every number, and the project overview shows milestones', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Kabir Mehta/ }).click();
  await page.goto('/o/1/reports');
  await expect(page.getByRole('heading', { name: 'How each number is calculated' })).toBeVisible();
  await expect(page.locator('.tile-formula')).toHaveCount(6);
  await page.goto('/o/1/projects/1');
  await page.getByRole('tab', { name: 'Overview' }).click();
  await expect(page.getByRole('button', { name: 'Launch', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Launch', exact: true }).click(); // jumps to the board filtered by that milestone
  await expect(page.getByRole('tab', { name: 'Board' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.card-title', { hasText: 'Write homepage copy' })).toHaveCount(0);
  await expect(page.locator('.card-title', { hasText: 'Build the pricing page' })).toBeVisible();
});
