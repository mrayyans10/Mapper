import { expect, test } from "@playwright/test";

test("vertical slice: infer, map, validate, save", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Mapping Assurance", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Infer schemas" }).click();
  await expect(page.getByText("Schemas inferred")).toBeVisible();

  await page.getByTestId("tree-node-$.customerId").click();
  await page.getByTestId("tree-node-$.id").click();
  await page.getByRole("button", { name: "Add mapping" }).click();

  await page.getByTestId("tree-node-$.fullName").click();
  await page.getByTestId("tree-node-$.name").click();
  await page.getByRole("button", { name: "Add mapping" }).click();

  await page.getByTestId("required-$.tier").check();

  await page.getByRole("button", { name: "Validate" }).click();
  await expect(page.getByText("Validation report generated")).toBeVisible();
  await expect(page.getByText("Required missing (project-wide)")).toBeVisible();

  await page.getByLabel("Project name").fill("E2E Customer Mapping");
  await page.getByRole("button", { name: "Save project" }).click();
  await expect(page.getByText(/Project (created|saved)/)).toBeVisible();
  await expect(page.getByText("E2E Customer Mapping").first()).toBeVisible();
});
