export const VERIFIER_STATUSES = [
  "Unclaimed",
  "Claimed",
  "Accepted",
  "Rejected",
  "Needs Review",
];

const VERIFIER_STATUS_SET = new Set(VERIFIER_STATUSES);
const SOURCE_SHEETS = new Set(["first_runs", "post_first_runs"]);
const RUN_FIELDS = [
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
    if (keys.length !== RUN_FIELDS.length || RUN_FIELDS.some((field) => !keys.includes(field))) {
      throw new Error(`Verifier queue record ${recordNumber} has an unexpected field set.`);
    }
    if (!SOURCE_SHEETS.has(run.sourceSheet)) {
      throw new Error(`Verifier queue record ${recordNumber} has an unknown worksheet.`);
    }
    if (!Number.isSafeInteger(run.row) || run.row < 2) {
      throw new Error(`Verifier queue record ${recordNumber} has an invalid worksheet row.`);
    }
    for (const field of [
      "runner",
      "game",
      "runType",
      "originalRunText",
      "category",
      "restrictions",
      "videoUrl",
      "claimedBy",
      "googleSheetUrl",
    ]) {
      if (typeof run[field] !== "string") {
        throw new Error(`Verifier queue record ${recordNumber} has an invalid ${field}.`);
      }
    }
    if (!run.runner.trim() || !run.game.trim() || !run.originalRunText.trim() || !run.category.trim()) {
      throw new Error(`Verifier queue record ${recordNumber} is missing required run details.`);
    }
    if (!VERIFIER_STATUS_SET.has(run.status)) {
      throw new Error(`Verifier queue record ${recordNumber} has an unknown status.`);
    }
    if (!isSafeExternalUrl(run.googleSheetUrl)) {
      throw new Error(`Verifier queue record ${recordNumber} has an invalid Google Sheet URL.`);
    }
    return { ...run };
  });
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
    const searchableValues = [run.runner, run.game, run.category, run.restrictions]
      .map(normalizeSearchText);
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
  url = "./data/verifier-queue-demo.json",
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
