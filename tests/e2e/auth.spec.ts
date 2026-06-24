import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 6 e2e — the authentication chain in a real browser:
 * browser → Vite web app → Express api → PostgreSQL.
 * Covers §22: register → authenticated → refresh persists → account
 * management → logout invalidates → wrong password fails generically →
 * valid login recovers → protected redirect → keyboard-only → responsive.
 */

const uniqueEmail = () => `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@heyrah.test`;
const password = "E2eWings!2026x";

async function registerViaUi(page: Page, email: string): Promise<void> {
  await page.goto("/register");
  await page.getByRole("textbox", { name: "Full name" }).fill("E2E Tester");
  await page.getByRole("textbox", { name: "Email address" }).fill(email);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("link", { name: "E2E Tester" })).toBeVisible({
    timeout: 10_000,
  });
}

test("register creates the account and the session survives a reload", async ({ page }) => {
  const email = uniqueEmail();
  await registerViaUi(page, email);

  // refresh: the session is restored from the server (cookie, not storage)
  await page.reload();
  await expect(page.getByRole("link", { name: "E2E Tester" })).toBeVisible({
    timeout: 10_000,
  });
});

test("wrong password shows the generic failure; correct password signs in", async ({ page }) => {
  const email = uniqueEmail();
  await registerViaUi(page, email);

  // sign out first
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible({
    timeout: 10_000,
  });

  await page.goto("/login");
  await page.getByRole("textbox", { name: "Email address" }).fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill("DefinitelyWrong!1");
  await page.getByRole("button", { name: "Sign in" }).click();

  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible({ timeout: 10_000 });
  await expect(alert).toHaveText("Incorrect email or password.");
  // typed email is preserved on failure
  await expect(page.getByRole("textbox", { name: "Email address" })).toHaveValue(email);

  // correct password signs in
  await page.getByRole("textbox", { name: "Password" }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "E2E Tester" })).toBeVisible({
    timeout: 10_000,
  });
});

test("protected /account redirects guests to login and returns after sign-in", async ({
  page,
}) => {
  const email = uniqueEmail();
  await registerViaUi(page, email);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible({
    timeout: 10_000,
  });

  // guest deep link → login wall
  await page.goto("/account");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  // signing in returns to the originally requested page
  await page.getByRole("textbox", { name: "Email address" }).fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/account$/, { timeout: 10_000 });
  await expect(page.getByRole("heading", { name: "Your account" })).toBeVisible();
});

test("account page changes password; old one dies, new one works", async ({ page }) => {
  const email = uniqueEmail();
  await registerViaUi(page, email);

  await page.getByRole("link", { name: "E2E Tester" }).click();
  await expect(page.getByRole("heading", { name: "Your account" })).toBeVisible({
    timeout: 10_000,
  });

  const newPassword = "R3newed!Wings26";
  await page.getByRole("textbox", { name: "Current password" }).fill("wrong-current-1");
  await page.getByRole("textbox", { name: "New password" }).fill(newPassword);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByRole("alert")).toContainText("incorrect", { timeout: 10_000 });

  await page.getByRole("textbox", { name: "Current password" }).fill(password);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByRole("status")).toContainText("password has been changed", {
    timeout: 10_000,
  });

  // sign out, old password rejected, new one accepted
  await page.getByRole("region", { name: "Session" }).getByRole("button").click();
  await expect(page).toHaveURL(/\/login$/, { timeout: 10_000 });

  await page.getByRole("textbox", { name: "Email address" }).fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toBeVisible({ timeout: 10_000 });

  await page.getByRole("textbox", { name: "Password" }).fill(newPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "E2E Tester" })).toBeVisible({
    timeout: 10_000,
  });
});

test("auth forms are fully keyboard operable", async ({ page }) => {
  const email = uniqueEmail();
  await page.goto("/register");

  // Tab to the first field, then fill everything keyboard-only
  await page.getByRole("textbox", { name: "Full name" }).focus();
  await page.keyboard.type("Keys Only");
  await page.keyboard.press("Tab");
  await page.keyboard.type(email);
  await page.keyboard.press("Tab");
  await page.keyboard.type(password);
  await page.keyboard.press("Enter"); // form submits from the password field

  await expect(page.getByRole("link", { name: "Keys Only" })).toBeVisible({
    timeout: 10_000,
  });
});

test("auth pages are usable at mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  const email = page.getByRole("textbox", { name: "Email address" });
  const submit = page.getByRole("button", { name: "Sign in" });

  // no horizontal overflow; controls within the viewport
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(email).toBeVisible();
  await expect(submit).toBeVisible();
});
