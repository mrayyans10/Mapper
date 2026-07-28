import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const arraySource = fs.readFileSync(
  path.join(process.cwd(), "fixtures/array-mapping/source.json"),
  "utf8",
);
const arrayTarget = fs.readFileSync(
  path.join(process.cwd(), "fixtures/array-mapping/target.json"),
  "utf8",
);

const addRuleBtn = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: "Add rule", exact: true });

const previewBtn = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: "Preview", exact: true });

test.describe("Step 5 rule authoring stability", () => {
  test("create group + conditional rule + child → validate issues visible", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Infer schemas" }).click();
    await expect(page.getByText("Schemas inferred")).toBeVisible();

    await page.getByTestId("tree-node-$").first().click();
    await page.getByRole("button", { name: "Add rule group" }).click();
    await page.getByTestId("tree-node-$.id").click();
    await addRuleBtn(page).click();

    await page.getByLabel("Rule name").fill("Email route");
    await page.getByLabel("Destination node").fill("$.contactEmail");
    await page.getByLabel("Condition (atom MVP)").fill("email");
    await page.getByLabel("Condition operator").selectOption("EXISTS");

    await page.getByRole("button", { name: "Add child mapping" }).click();
    await page.getByLabel("Child source path").fill("email");
    await page.getByLabel("Child target path").fill(".");

    await page.getByRole("button", { name: "Validate" }).click();
    await expect(page.getByText("Validation report generated")).toBeVisible();
    await expect(page.getByTestId("validation-panel")).toBeVisible();
  });

  test("enable/disable + reorder + click issue navigates to rule", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Infer schemas" }).click();
    await expect(page.getByText("Schemas inferred")).toBeVisible();

    await page.getByRole("button", { name: "Add rule group" }).click();
    await page.getByTestId("tree-node-$.contactEmail").click();
    await addRuleBtn(page).click();
    await page.getByLabel("Rule name").fill("First");
    await page.getByLabel("Destination node").fill("$.contactEmail");
    await page.locator("#rule-kind").selectOption("unconditional");

    await page.getByTestId("tree-node-$.name").click();
    await addRuleBtn(page).click();
    await page.getByLabel("Rule name").fill("Second");
    await page.getByLabel("Destination node").fill("$.name");
    await page.locator("#rule-kind").selectOption("unconditional");

    const secondId = await page
      .locator("[data-testid^='rule-row-']")
      .nth(1)
      .getAttribute("data-testid");
    expect(secondId).toBeTruthy();
    const ruleId = secondId!.replace("rule-row-", "");
    await page.getByTestId(`rule-move-up-${ruleId}`).click();
    await expect(page.getByLabel("Priority")).toHaveValue("10");

    await page.getByLabel("enabled").uncheck();
    await previewBtn(page).click();
    await expect(page.getByText("Preview generated")).toBeVisible();
    await expect(page.getByTestId("preview-skipped")).toContainText(
      /disabled|skip/i,
    );

    // Click skipped preview row → navigates to rule
    await page.getByTestId("preview-skipped").locator("button").first().click();
    await expect(
      page.locator(".rule-row.active [aria-current='true']").first(),
    ).toBeVisible();

    await page.getByRole("button", { name: "Validate" }).click();
    await expect(page.getByText("Validation report generated")).toBeVisible();
    const clickableIssue = page.locator("button.nav-issue.clickable").first();
    if ((await clickableIssue.count()) > 0) {
      await clickableIssue.click();
      await expect(
        page.locator(".rule-row.active [aria-current='true']").first(),
      ).toBeVisible();
    }
  });

  test("nested array preview appends two elements + transform warning", async ({
    page,
  }) => {
    await page.goto("/");
    await page.locator("#json-Source\\ JSON").fill(arraySource);
    await page.locator("#json-Target\\ JSON").fill(arrayTarget);
    await page.getByRole("button", { name: "Infer schemas" }).click();
    await expect(page.getByText("Schemas inferred")).toBeVisible();

    await page.getByRole("button", { name: "Add rule group" }).click();
    await page.getByLabel("Source node").fill("$.items[*]");
    await expect(page.getByTestId("array-hint")).toBeVisible();

    await page.getByTestId("tree-node-$.lineItems").click();
    await addRuleBtn(page).click();
    await page.getByLabel("Rule name").fill("Lines");
    await page.getByLabel("Destination node").fill("$.lineItems[*]");
    await page.locator("#rule-kind").selectOption("unconditional");
    await page.locator("#rule-copy-mode").selectOption("APPLY_CHILD_MAPPINGS");

    await page.getByRole("button", { name: "Add child mapping" }).click();
    await page.getByLabel("Child source path").fill("sku");
    await page.getByLabel("Child target path").fill("productCode");
    await page.getByLabel("Transformation type metadata").fill("identity");

    await page.getByRole("button", { name: "Add child mapping" }).click();
    await page.getByLabel("Child source path").nth(1).fill("qty");
    await page.getByLabel("Child target path").nth(1).fill("quantity");

    await previewBtn(page).click();
    await expect(page.getByText("Preview generated")).toBeVisible();
    await expect(page.getByTestId("preview-warnings")).toContainText(
      /NOT executed/i,
    );

    const result = page.getByLabel("Preview result object");
    const text = await result.inputValue();
    const parsed = JSON.parse(text) as { lineItems?: unknown[] };
    expect(Array.isArray(parsed.lineItems)).toBe(true);
    expect(parsed.lineItems!.length).toBeGreaterThanOrEqual(2);
  });

  test("legacy v1 migration reload + exports + simulator + template", async ({
    page,
    request,
  }) => {
    const sourceJson = `{
      "email": "a@b.com",
      "age": 42
    }`;
    const targetJson = `{
      "contactEmail": "a@b.com",
      "years": 42
    }`;

    const projectName = `E2E Legacy Migrate ${Date.now()}`;
    const created = await request.post("http://127.0.0.1:3001/api/projects", {
      data: {
        name: projectName,
        sourceJson,
        targetJson,
      },
    });
    expect(created.ok()).toBeTruthy();
    const createdBody = (await created.json()) as { project: { id: string } };
    const id = createdBody.project.id;

    // Omit ruleGroups so dual-write migrates mappings → legacy direct rules
    const updated = await request.put(
      `http://127.0.0.1:3001/api/projects/${id}`,
      {
        data: {
          mappings: [
            {
              id: "map_email",
              sourcePath: "$.email",
              targetPath: "$.contactEmail",
              status: "draft",
            },
            {
              id: "map_age",
              sourcePath: "$.age",
              targetPath: "$.years",
              status: "reviewed",
              transformationNote: "identity",
            },
          ],
          runValidation: true,
        },
      },
    );
    expect(updated.ok()).toBeTruthy();
    const updatedBody = (await updated.json()) as {
      project: {
        schemaVersion: number;
        ruleGroups: Array<{
          rules: Array<{ id: string; migrationSource?: string }>;
        }>;
      };
    };
    expect(updatedBody.project.schemaVersion).toBe(2);
    expect(
      updatedBody.project.ruleGroups.some((g) =>
        g.rules.some((r) => r.migrationSource === "FIELD_MAPPING_V1"),
      ),
    ).toBe(true);

    await page.goto("/");
    await page.getByTestId(`open-project-${id}`).click();
    await expect(page.getByText(new RegExp(`Loaded ${projectName}`))).toBeVisible();
    await expect(page.getByText("legacy").first()).toBeVisible();

    await page.getByRole("button", { name: "Save project" }).click();
    await expect(page.getByText(/Project (created|saved)/)).toBeVisible();

    const reopened = await request.get(
      `http://127.0.0.1:3001/api/projects/${id}`,
    );
    const reBody = (await reopened.json()) as {
      project: { schemaVersion: number; ruleGroups: unknown[] };
    };
    expect(reBody.project.schemaVersion).toBe(2);
    expect(reBody.project.ruleGroups.length).toBeGreaterThan(0);

    const rulesExport = await request.get(
      `http://127.0.0.1:3001/api/projects/${id}/export/rules.json`,
    );
    expect(rulesExport.ok()).toBeTruthy();
    const rulesJson = (await rulesExport.json()) as {
      ruleGroups: unknown[];
    };
    expect(rulesJson.ruleGroups.length).toBeGreaterThan(0);

    const reportExport = await request.get(
      `http://127.0.0.1:3001/api/projects/${id}/export/report.json`,
    );
    expect(reportExport.ok()).toBeTruthy();
    const reportJson = (await reportExport.json()) as {
      summary?: unknown;
    };
    expect(reportJson).toHaveProperty("summary");

    await page.locator("[data-testid^='rule-row-']").first().click();
    await page.getByRole("button", { name: "Simulate selected rule" }).click();
    await expect(page.getByTestId("sim-results")).toBeVisible();

    await page.getByLabel("Save selected rule as template").fill("E2E Direct");
    await page.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByText("Template saved")).toBeVisible();
    await expect(page.getByText("E2E Direct")).toBeVisible();
  });
});
