export const VERIFIER_STATUSES = [
  "Unclaimed",
  "Claimed",
  "Accepted",
  "Rejected",
  "Needs Review",
];

const VERIFIER_STATUS_SET = new Set(VERIFIER_STATUSES);
const SOURCE_SHEETS = new Set(["first_runs", "post_first_runs"]);
const DEMO_RUN_FIELDS = [
  "sourceSheet",
  "row",
  "runner",
  "game",
  "runType",
  "originalRunText",
  "category",
  "restrictions",
  "videoUrl",
  "status",
  "claimedBy",
  "googleSheetUrl",
];
const WORKBOOK_RUN_FIELDS = [
  "sourceSheet",
  "submissionType",
  "row",
  "runner",
  "game",
  "runType",
  "originalRunText",
  "category",
  "restrictions",
  "categorySplitReliable",
  "categorySplitReason",
  "videoUrl",
  "status",
  "verifier",
  "dateClaimed",
  "verdict",
  "dateVerified",
  "formulaBackedFields",
  "formulaOnlyRow",
];
const PUBLIC_RUN_FIELDS = [
  "runner",
  "game",
  "runType",
  "originalRunText",
  "category",
  "restrictions",
  "categorySplitReliable",
  "videoUrl",
  "status",
  "verifier",
];
const EXPECTED_WORKBOOK_RUN_COUNT = 16234;
const VERIFIER_SEARCH_INDEX = new WeakMap();

export function classifyVerificationStatus({ verifier, dateClaimed, verdict, dateVerified }) {
  const normalizedVerdict = verdict.trim().toLowerCase();
  if (normalizedVerdict === "accepted") {
    return "Accepted";
  }
  if (normalizedVerdict === "rejected") {
    return "Rejected";
  }
  if (normalizedVerdict !== "") {
    return "Needs Review";
  }

  const normalizedVerifier = verifier.trim().toLowerCase();
  const hasNamedVerifier = normalizedVerifier !== ""
    && !["n/a", "na", "none"].includes(normalizedVerifier);
  if (hasNamedVerifier) {
    return "Claimed";
  }
  if (!dateClaimed.trim() && !dateVerified.trim()) {
    return "Unclaimed";
  }
  return "Needs Review";
}

export function isSafeExternalUrl(value) {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:")
      && Boolean(url.hostname)
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

export function verifierDisplayCategory(run) {
  return run.categorySplitReliable === false ? run.originalRunText : run.category;
}

export function verifierDisplayRestrictions(run) {
  return run.categorySplitReliable === false ? "" : run.restrictions;
}

export function validateVerifierRuns(value) {
  if (!Array.isArray(value)) {
    throw new Error("Verifier queue JSON must contain an array.");
  }

  return value.map((run, index) => {
    const recordNumber = index + 1;
    if (run === null || typeof run !== "object" || Array.isArray(run)) {
      throw new Error(`Verifier queue record ${recordNumber} must be an object.`);
    }
    const keys = Object.keys(run);
    const workbookRecord = keys.length === WORKBOOK_RUN_FIELDS.length
      && WORKBOOK_RUN_FIELDS.every((field) => keys.includes(field));
    const publicRecord = keys.length === PUBLIC_RUN_FIELDS.length
      && PUBLIC_RUN_FIELDS.every((field) => keys.includes(field));
    const demoRecord = keys.length === DEMO_RUN_FIELDS.length
      && DEMO_RUN_FIELDS.every((field) => keys.includes(field));
    if (!workbookRecord && !publicRecord && !demoRecord) {
      throw new Error(`Verifier queue record ${recordNumber} has an unexpected field set.`);
    }
    if (!publicRecord && !SOURCE_SHEETS.has(run.sourceSheet)) {
      throw new Error(`Verifier queue record ${recordNumber} has an unknown worksheet.`);
    }
    if (!publicRecord && (!Number.isSafeInteger(run.row) || run.row < 2)) {
      throw new Error(`Verifier queue record ${recordNumber} has an invalid worksheet row.`);
    }
    if (workbookRecord
        && (run.submissionType !== (run.sourceSheet === "first_runs" ? "first" : "post")
          || typeof run.categorySplitReliable !== "boolean"
          || typeof run.categorySplitReason !== "string"
          || typeof run.formulaOnlyRow !== "boolean"
          || !Array.isArray(run.formulaBackedFields)
          || run.formulaBackedFields.some((field) => typeof field !== "string"))) {
      throw new Error(`Verifier queue record ${recordNumber} has invalid workbook metadata.`);
    }
    if (publicRecord && typeof run.categorySplitReliable !== "boolean") {
      throw new Error(`Verifier queue record ${recordNumber} has invalid public queue metadata.`);
    }
    for (const field of [
      "runner",
      "game",
      "runType",
      "originalRunText",
      "category",
      "restrictions",
      "videoUrl",
      ...(workbookRecord
        ? ["verifier", "dateClaimed", "verdict", "dateVerified"]
        : publicRecord
          ? ["verifier"]
          : ["claimedBy", "googleSheetUrl"]),
    ]) {
      if (typeof run[field] !== "string") {
        throw new Error(`Verifier queue record ${recordNumber} has an invalid ${field}.`);
      }
    }
    if (!run.runner.trim() || !run.game.trim() || !run.originalRunText.trim()
        || (!run.category.trim() && run.categorySplitReliable !== false)) {
      throw new Error(`Verifier queue record ${recordNumber} is missing required run details.`);
    }
    if (!VERIFIER_STATUS_SET.has(run.status)) {
      throw new Error(`Verifier queue record ${recordNumber} has an unknown status.`);
    }
    if (demoRecord && !isSafeExternalUrl(run.googleSheetUrl)) {
      throw new Error(`Verifier queue record ${recordNumber} has an invalid Google Sheet URL.`);
    }
    return { ...run };
  });
}

export function projectPublicVerifierRuns(value) {
  const workbookRuns = validateVerifierRuns(value);
  if (workbookRuns.length !== EXPECTED_WORKBOOK_RUN_COUNT
      || workbookRuns.some((run) => !Object.hasOwn(run, "formulaOnlyRow"))) {
    throw new Error(`Local verifier workbook data must contain exactly ${EXPECTED_WORKBOOK_RUN_COUNT} workbook records.`);
  }

  const publicRuns = workbookRuns.map((run) => ({
    runner: run.runner,
    game: run.game,
    runType: run.runType,
    originalRunText: run.originalRunText,
    category: run.category,
    restrictions: run.restrictions,
    categorySplitReliable: run.categorySplitReliable,
    videoUrl: run.videoUrl,
    status: run.status,
    verifier: run.verifier,
  }));
  validateVerifierRuns(publicRuns);

  const countStatuses = (runs) => Object.fromEntries(
    VERIFIER_STATUSES.map((status) => [
      status,
      runs.filter((run) => run.status === status).length,
    ]),
  );
  if (JSON.stringify(countStatuses(workbookRuns)) !== JSON.stringify(countStatuses(publicRuns))) {
    throw new Error("Public verifier projection changed the status counts.");
  }
  return publicRuns;
}

function normalizeSearchText(value) {
  return value.toLocaleLowerCase().normalize("NFKC");
}

export function filterVerifierRuns(runs, {
  query = "",
  game = "",
  status = "",
} = {}) {
  const terms = normalizeSearchText(query).trim().split(/\s+/u).filter(Boolean);
  return runs.filter((run) => {
    if (game && run.game !== game) {
      return false;
    }
    if (status && run.status !== status) {
      return false;
    }
    if (terms.length === 0) {
      return true;
    }
    let searchableValues = VERIFIER_SEARCH_INDEX.get(run);
    if (!searchableValues) {
      searchableValues = [
        run.runner,
        run.game,
        run.originalRunText,
        run.category,
        run.restrictions,
        run.runType,
      ].map(normalizeSearchText);
      VERIFIER_SEARCH_INDEX.set(run, searchableValues);
    }
    return terms.every((term) => searchableValues.some((value) => value.includes(term)));
  });
}

export function availableVerifierOptions(runs, field) {
  if (field !== "game") {
    throw new Error(`Unsupported verifier queue filter field: ${field}.`);
  }
  return [...new Set(runs.map((run) => run[field]).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
}

export async function loadVerifierQueue(
  url = "./data/verifier-queue-public.json",
  fetchImplementation = globalThis.fetch,
) {
  if (typeof fetchImplementation !== "function") {
    throw new Error("Fetch is unavailable. Open this page through a local HTTP server.");
  }
  const response = await fetchImplementation(url);
  if (!response.ok) {
    throw new Error(`Could not load verifier queue data (${response.status} ${response.statusText}).`);
  }
  let data;
  try {
    data = await response.json();
  } catch (error) {
    throw new Error(`Verifier queue data is not valid JSON: ${error.message}`);
  }
  return validateVerifierRuns(data);
}
