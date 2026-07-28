import { test, expect } from "@playwright/test";

test("homepage loads with the Overview stage active", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("One identity. Every surface.");
  await expect(page.locator(".nav-item.active")).toHaveText(/Overview/);
});

test("clicking a sidebar stage tab changes both the highlight and the page content", async ({ page }) => {
  await page.goto("/");
  const heroTitle = page.locator(".hero h1");
  await expect(heroTitle).toContainText("One identity. Every surface.");

  await page.locator(".sidebar nav").getByRole("button", { name: "Canon" }).click();

  await expect(page.locator(".nav-item.active")).toHaveText(/Canon/);
  await expect(heroTitle).toContainText("Build a person, not a prompt.");
});

test("every stage tab renders its own distinct hero title", async ({ page }) => {
  await page.goto("/");
  const stages: Record<string, string> = {
    Overview: "One identity. Every surface.",
    Canon: "Build a person, not a prompt.",
    References: "Coverage before volume.",
    Dataset: "Curate what the model learns.",
    Train: "Recommended settings, visible logic.",
    Create: "Recipes before random prompts.",
    Validate: "A score must show its work.",
    Launch: "Release only what you can defend.",
  };

  for (const [stage, expectedTitle] of Object.entries(stages)) {
    await page.locator(".sidebar nav").getByRole("button", { name: stage }).click();
    await expect(page.locator(".hero h1")).toContainText(expectedTitle);
  }
});

test("switching the active project (Mara/Lila) updates the portrait and identity fields", async ({ page }) => {
  await page.goto("/");
  await page.locator(".sidebar nav").getByRole("button", { name: "Canon" }).click();

  await expect(page.locator(".anchor strong")).toHaveText("Silver left-temple streak");

  await page.locator(".project-tabs").getByRole("button", { name: "Lila Mercer" }).click();

  await expect(page.locator(".anchor strong")).toHaveText("Delicate gold bracelet");
});

test("Mara and Lila portraits render as real, decodable images", async ({ page }) => {
  await page.goto("/");

  for (const src of ["/mara.png", "/lila.png"]) {
    const naturalWidth = await page.evaluate(async (url) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img.naturalWidth;
    }, src);
    expect(naturalWidth).toBeGreaterThan(0);
  }
});
