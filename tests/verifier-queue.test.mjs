import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const moduleSource = await readFile(new URL("../verifier-queue.js", import.meta.url), "utf8");
const queueModule = await import(
  `data:text/javascript;base64,${Buffer.from(moduleSource).toString("base64")}`
);
const {
  VERIFIER_STATUSES,
  availableVerifierOptions,
  classifyVerificationStatus,
  filterVerifierRuns,
  isSafeExternalUrl,
  validateVerifierRuns,
} = queueModule;

const sheetUrl = "https://example.com/demo-sheet";

function makeRun(overrides = {}) {
  return {
    sourceSheet: "first_runs",
    row: 2,
    runner: "Runner One",
    game: "Dark Souls",
    runType: "Hitless",
    originalRunText: "Any% SL1",
    category: "Any%",
    restrictions: "SL1",
    videoUrl: "https://www.youtube.com/watch?v=abc",
    status: "Unclaimed",
    claimedBy: "",
    googleSheetUrl: sheetUrl,
    ...overrides,
  };
}

test("classifies only explicit verdicts and conservative claim fields", () => {
  assert.equal(classifyVerificationStatus({
    verifier: "n/a", dateClaimed: "", verdict: "Accepted", dateVerified: "2026-01-01",
  }), "Accepted");
  assert.equal(classifyVerificationStatus({
    verifier: "", dateClaimed: "", verdict: "Rejected", dateVerified: "",
  }), "Rejected");
  assert.equal(classifyVerificationStatus({
    verifier: "Seki", dateClaimed: "", verdict: "", dateVerified: "",
  }), "Claimed");
  assert.equal(classifyVerificationStatus({
    verifier: "n/a", dateClaimed: "", verdict: "", dateVerified: "",
  }), "Unclaimed");
  assert.equal(classifyVerificationStatus({
    verifier: "n/a", dateClaimed: "", verdict: "", dateVerified: "1900-01-01",
  }), "Needs Review");
  assert.equal(classifyVerificationStatus({
    verifier: "", dateClaimed: "2026-01-01", verdict: "", dateVerified: "",
  }), "Needs Review");
  assert.equal(classifyVerificationStatus({
    verifier: "", dateClaimed: "", verdict: "Pending", dateVerified: "",
  }), "Needs Review");
});

test("preserves worksheet, source row, original text and separated demo fields", () => {
  const originalTitle = "All Bosses SL1 No Roll";
  const run = makeRun({
    sourceSheet: "post_first_runs",
    row: 178,
    originalRunText: originalTitle,
    category: "All Bosses",
    restrictions: "SL1 No Roll",
  });
  const [validated] = validateVerifierRuns([run]);
  assert.equal(validated.sourceSheet, "post_first_runs");
  assert.equal(validated.row, 178);
  assert.equal(validated.originalRunText, originalTitle);
  assert.equal(validated.category, "All Bosses");
  assert.equal(validated.restrictions, "SL1 No Roll");
  assert.equal(validated.restrictions.includes(validated.category), false);
  assert.throws(() => validateVerifierRuns([makeRun({ row: 1 })]), /worksheet row/u);
  assert.throws(() => validateVerifierRuns([makeRun({ sourceSheet: "other" })]), /worksheet/u);
});

test("searches runner, game, category and restrictions without a run type filter", () => {
  const runs = [
    makeRun(),
    makeRun({
      row: 3,
      runner: "Another",
      game: "Bloodborne",
      originalRunText: "All Bosses BL4 No Damage",
      category: "All Bosses",
      restrictions: "BL4 No Damage",
    }),
  ];
  assert.deepEqual(filterVerifierRuns(runs, { query: "runner sl1" }), [runs[0]]);
  assert.deepEqual(filterVerifierRuns(runs, { query: "bloodborne damage" }), [runs[1]]);
  assert.deepEqual(filterVerifierRuns(runs, { query: "all bosses" }), [runs[1]]);
  assert.deepEqual(filterVerifierRuns(runs, { game: "Dark Souls" }), [runs[0]]);
  assert.deepEqual(filterVerifierRuns(runs, { status: "Unclaimed" }), runs);
  assert.deepEqual(availableVerifierOptions(runs, "game"), ["Bloodborne", "Dark Souls"]);
  assert.throws(() => availableVerifierOptions(runs, "runType"), /Unsupported/u);
});

test("rejects unsafe video URL schemes and credentials", () => {
  assert.equal(isSafeExternalUrl("https://youtu.be/abc"), true);
  assert.equal(isSafeExternalUrl("javascript:alert(1)"), false);
  assert.equal(isSafeExternalUrl(["https://example.com", "evil.example/video"].join("@")), false);
  assert.equal(isSafeExternalUrl("not a url"), false);
});

test("rejects unsupported or incomplete records instead of silently accepting them", () => {
  assert.throws(() => validateVerifierRuns({}), /array/u);
  assert.throws(() => validateVerifierRuns([makeRun({ status: "Pending" })]), /unknown status/u);
  assert.throws(() => validateVerifierRuns([makeRun({ googleSheetUrl: "javascript:alert(1)" })]), /Google Sheet URL/u);
});

test("ships only 10–15 clearly fictional demo records covering every status", async () => {
  const demoJson = await readFile(new URL("../data/verifier-queue-demo.json", import.meta.url), "utf8");
  const runs = validateVerifierRuns(JSON.parse(demoJson));
  assert.ok(runs.length >= 10 && runs.length <= 15);
  assert.deepEqual(
    [...new Set(runs.map((run) => run.status))].sort(),
    [...VERIFIER_STATUSES].sort(),
  );
  assert.ok(runs.every((run) => run.runner.startsWith("Demo Runner ")
    && run.originalRunText.length > 0
    && run.category.length > 0
    && run.runType.length > 0
    && !run.restrictions.includes(run.category)
    && run.videoUrl.startsWith("https://example.com/demo-video/")
    && run.googleSheetUrl === "https://example.com/demo-sheet"));
});
