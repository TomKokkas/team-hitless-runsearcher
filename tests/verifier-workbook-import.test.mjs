import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { importVerifierWorkbook, splitCategory } from "../verifier-workbook-import.mjs";

const workbookPath = "C:\\Users\\User\\Downloads\\TH Verifier workbook.xlsx";

test("splits only recognized category and restriction patterns", () => {
  assert.deepEqual(splitCategory("Any% SL1 No Damage", "Dark Souls"), {
    category: "Any%",
    restrictions: "SL1 / No Damage",
    reliable: true,
    reason: "",
  });
  assert.deepEqual(splitCategory("DS3 any% no hit", "Dark Souls III"), {
    category: "Any%",
    restrictions: "",
    reliable: true,
    reason: "",
  });
  assert.deepEqual(splitCategory(
    "BL4 Hitless Any% without Rolling/Quickstepping/Guns",
    "Bloodborne",
  ), {
    category: "Any%",
    restrictions: "BL4 / No Roll / No Quickstep / No Guns",
    reliable: true,
    reason: "",
  });
  assert.deepEqual(splitCategory("SL1 Any% Damageless", "Dark Souls"), {
    category: "Any%",
    restrictions: "SL1 / Damageless",
    reliable: true,
    reason: "",
  });
  assert.deepEqual(splitCategory("DS3 All Bosses No Hit", "Dark Souls III"), {
    category: "All Bosses",
    restrictions: "",
    reliable: true,
    reason: "",
  });
  assert.deepEqual(splitCategory("DeS SL1 Any% No Magic", "Demon's Souls"), {
    category: "Any%",
    restrictions: "SL1 / No Magic",
    reliable: true,
    reason: "",
  });
  assert.deepEqual(splitCategory(
    "Dark Souls 1 NG+ SORCERY ONLY NO-HIT RUN Any%",
    "Dark Souls or Dark Souls: Remastered",
  ), {
    category: "Any%",
    restrictions: "NG+ / Sorcery Only",
    reliable: true,
    reason: "",
  });
  assert.deepEqual(splitCategory(
    "Hollow Knight No Hit Any% (No Steel Soul)",
    "Hollow Knight",
  ), {
    category: "Any%",
    restrictions: "No Steel Soul",
    reliable: true,
    reason: "",
  });
  assert.deepEqual(splitCategory("Unknown challenge label", "Bloodborne"), {
    category: "Unknown challenge label",
    restrictions: "",
    reliable: false,
    reason: "No recognized category phrase",
  });
});

test("imports all real submissions including cached-formula values", async () => {
  const { runs, report } = await importVerifierWorkbook(workbookPath);

  assert.equal(runs.length, 16234);
  assert.deepEqual(report.countsBySheet, {
    first_runs: 3009,
    post_first_runs: 13225,
  });
  assert.equal(report.cachedFormulaOnlySubmissionCount, 279);
  assert.equal(report.reliableCategoryRestrictionsSplitCount
    + report.unreliableCategoryRestrictionsSplitCount, 16234);
  assert.equal(report.cachedFormulaOnlySubmissions.length, 279);
  assert.deepEqual(report.partialCoreFieldRows, []);
  assert.equal(report.duplicatesRemoved, 0);
  assert.equal(report.googleSheetRowLinksCreated, 0);

  const firstRuns = runs.filter((run) => run.sourceSheet === "first_runs");
  const postRuns = runs.filter((run) => run.sourceSheet === "post_first_runs");
  assert.equal(firstRuns.length, 3009);
  assert.equal(postRuns.length, 13225);
  assert.ok(firstRuns.every((run) => run.submissionType === "first"));
  assert.ok(postRuns.every((run) => run.submissionType === "post"));
  assert.equal(new Set(runs.map((run) => `${run.sourceSheet}:${run.row}`)).size, runs.length);

  const formulaCachedFirstRun = firstRuns.find((run) => run.row === 432);
  assert.equal(formulaCachedFirstRun.runner, "BufandaDel");
  assert.equal(formulaCachedFirstRun.game, "Cuphead");
  assert.equal(formulaCachedFirstRun.videoUrl, "https://www.youtube.com/watch?v=Cyl5tl4nLaY&ab_channel=BufandaDelYT");
  assert.equal(formulaCachedFirstRun.originalRunText, "Expert Any% No Dash and Miniplane");
  assert.equal(formulaCachedFirstRun.formulaOnlyRow, true);
  assert.ok(formulaCachedFirstRun.formulaBackedFields.includes("B"));
  assert.ok(formulaCachedFirstRun.formulaBackedFields.includes("K"));

  const postRun = postRuns.find((run) => run.row === 1292);
  assert.equal(postRun.runner, "zNahue");
  assert.equal(postRun.game, "Sekiro: Shadows Die Twice");
  assert.equal(postRun.videoUrl, "https://youtu.be/fvlnCGnh1oQ");

  const fudgecow = firstRuns.find((run) => run.runner === "Fudgecow");
  assert.equal(fudgecow.originalRunText, "DS3 any% no hit");
  assert.equal(fudgecow.category, "Any%");
  assert.equal(fudgecow.restrictions, "");
  assert.equal(fudgecow.categorySplitReliable, true);

  const glance = firstRuns.find((run) => run.runner === "Glance___");
  assert.equal(glance.originalRunText, "Hollow Knight No Hit Any% (No Steel Soul)");
  assert.equal(glance.category, "Any%");
  assert.equal(glance.restrictions, "No Steel Soul");
  assert.equal(glance.categorySplitReliable, true);

  const cuberDarksouls = firstRuns.find((run) => run.runner === "cuber1717");
  assert.equal(cuberDarksouls.originalRunText, "Dark Souls 3 Any% No Hit");
  assert.equal(cuberDarksouls.category, "Any%");
  assert.equal(cuberDarksouls.restrictions, "");

  const statusTotals = Object.values(report.countsByStatus).reduce((sum, count) => sum + count, 0);
  assert.equal(statusTotals, runs.length);
  assert.ok(runs.every((run) => [
    "Unclaimed", "Claimed", "Accepted", "Rejected", "Needs Review",
  ].includes(run.status)));
  assert.ok(report.problematicVideoUrls.every((issue) => (
    runs.find((run) => run.sourceSheet === issue.sourceSheet && run.row === issue.row)?.videoUrl
      === issue.videoUrl
  )));
  assert.ok(report.unreliableCategoryRestrictionsSplits.every((issue) => {
    const run = runs.find((record) => record.sourceSheet === issue.sourceSheet && record.row === issue.row);
    return run?.originalRunText === issue.originalRunText
      && run.category === run.originalRunText
      && run.restrictions === "";
  }));
  assert.ok(runs.every((run) => (
    run.sourceSheet && run.submissionType && Number.isInteger(run.row)
      && typeof run.categorySplitReason === "string"
      && Object.hasOwn(run, "verifier")
      && Object.hasOwn(run, "dateClaimed")
      && Object.hasOwn(run, "verdict")
      && Object.hasOwn(run, "dateVerified")
  )));
});

test("persisted local import and report match the validated records", async () => {
  const data = JSON.parse(await readFile(new URL("../data/verifier-queue-workbook.json", import.meta.url), "utf8"));
  const report = JSON.parse(await readFile(new URL("../data/verifier-queue-workbook-report.json", import.meta.url), "utf8"));
  assert.equal(data.length, 16234);
  assert.equal(report.totalSubmissions, data.length);
  assert.deepEqual(report.countsBySheet, { first_runs: 3009, post_first_runs: 13225 });
  assert.equal(report.cachedFormulaOnlySubmissionCount, 279);
  assert.equal(report.reliableCategoryRestrictionsSplitCount
    + report.unreliableCategoryRestrictionsSplitCount, data.length);
  assert.equal(report.duplicatesRemoved, 0);
  assert.equal(report.googleSheetRowLinksCreated, 0);
  assert.equal(report.problematicVideoUrlCount, report.problematicVideoUrls.length);
  assert.equal(report.needsReviewCount, report.needsReviewRecords.length);
  assert.equal(
    report.unreliableCategoryRestrictionsSplitCount,
    report.unreliableCategoryRestrictionsSplits.length,
  );
});
