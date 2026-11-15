import { expect, test, type Page } from '@playwright/test';

async function signInAs(page: Page, name: string) {
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name.split(' ')[0]);
}

test('a manager moves a card across the board with only the keyboard', async ({ page }) => {
  await signInAs(page, 'Kabir Mehta');
  await page.getByRole('link', { name: 'Projects' }).click();
  await page.getByRole('link', { name: /Website relaunch/ }).click();
  const card = page.locator('.col-todo .card-wrap').first();
  const title = await card.locator('.card-title').innerText();
  await card.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('.card-wrap.is-dragging')).toHaveCount(1); // lifted
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.col-in_progress .card-title', { hasText: title })).toHaveCount(1);
  await page.keyboard.press('Space');
  await expect(page.locator('.col-in_progress .card-title', { hasText: title })).toBeVisible();
  await page.reload(); // it was saved, not just moved on screen
  await expect(page.locator('.col-in_progress .card-title', { hasText: title })).toBeVisible();
});

test('a task can be created, commented on and finished', async ({ page }) => {
  const name = `Write the press release ${Date.now()}`;
  await signInAs(page, 'Asha Rao');
  await page.getByRole('link', { name: 'Projects' }).click();
  await page.getByRole('link', { name: /Website relaunch/ }).click();
  await page.locator('.col-todo').getByRole('button', { name: 'Add a task' }).click();
  await page.getByLabel('New task in To do').fill(name);
  await page.keyboard.press('Enter');
  await page.locator('.card-title', { hasText: name }).click();
  await page.getByLabel('Write a comment').fill('First draft by Friday?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.bubble', { hasText: 'First draft by Friday?' })).toBeVisible();
  await page.locator('.status-select').selectOption('done');
  await page.getByRole('button', { name: 'Close task' }).click();
  await expect(page.locator('.col-done .card-title', { hasText: name })).toBeVisible();
});

test('an employee cannot see a project she is not on, even by typing the URL', async ({ page }) => {
  await signInAs(page, 'Meera Iyer');
  await page.getByRole('link', { name: 'Projects' }).click();
  await expect(page.locator('.project-card')).toHaveCount(1);
  await page.goto('/o/1/projects/2');
  await expect(page.getByText('We could not find that project')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Reports' })).toHaveCount(0);
});

test("one company cannot open the other company's workspace", async ({ page }) => {
  await signInAs(page, 'Vikram Shah');
  await page.goto('/o/1/projects');
  await expect(page.getByText('You are not part of this organisation')).toBeVisible();
  const api = await page.request.get('/api/orgs/1/projects');
  expect(api.status()).toBe(404);
});
