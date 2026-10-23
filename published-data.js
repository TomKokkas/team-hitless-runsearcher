export const ACTIVE_RELEASE_MANIFEST_HEADER = "RUNSEARCHER-ACTIVE-RELEASE\t1";

const RELEASE_ID_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:\.\d+)?Z-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const RUN_FIELDS = ["runner", "game", "category", "runName", "runLink"];

export function parseActiveReleaseManifest(content) {
  if (typeof content !== "string") {
    throw new TypeError("Published release manifest must be text.");
  }
  const match = content.match(
    /^RUNSEARCHER-ACTIVE-RELEASE\t1\n([^\r\n]+)\n$/u,
  );
  if (!match || !RELEASE_ID_PATTERN.test(match[1])) {
    throw new Error("Published release manifest is malformed or contains an unsafe release ID.");
  }
  return match[1];
}

function validateRunUrl(value) {
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

export function validatePublishedRuns(value) {
  if (!Array.isArray(value)) {
    throw new Error("Published runs JSON must contain an array.");
  }

  return value.map((run, index) => {
    if (run === null || typeof run !== "object" || Array.isArray(run)) {
      throw new Error(`Published run ${index + 1} must be an object.`);
    }
    const keys = Object.keys(run);
    if (keys.length !== RUN_FIELDS.length || RUN_FIELDS.some((field) => !keys.includes(field))) {
      throw new Error(`Published run ${index + 1} must contain exactly: ${RUN_FIELDS.join(", ")}.`);
    }
    for (const field of RUN_FIELDS) {
      if (typeof run[field] !== "string" || run[field].trim() === "") {
        throw new Error(`Published run ${index + 1} has an invalid ${field} value.`);
      }
    }
    if (!validateRunUrl(run.runLink)) {
      throw new Error(`Published run ${index + 1} has an invalid HTTP/HTTPS runLink.`);
    }
    return {
      runner: run.runner,
      game: run.game,
      category: run.category,
      runName: run.runName,
      runLink: run.runLink,
    };
  });
}

async function responseText(response, description) {
  try {
    if (typeof response.arrayBuffer === "function") {
      return new TextDecoder("utf-8", { fatal: true }).decode(await response.arrayBuffer());
    }
    return await response.text();
  } catch (error) {
    throw new Error(`${description} is not valid UTF-8: ${error.message}`);
  }
}

async function loadCsvFallback(loadFallback, warning = null) {
  const runs = await loadFallback();
  return {
    runs,
    source: "local-preview",
    warning,
  };
}

export async function loadRunData({
  fetchImplementation = globalThis.fetch,
  loadFallback,
  publishedBaseUrl = "./published",
} = {}) {
  if (typeof fetchImplementation !== "function") {
    throw new Error("Fetch is unavailable. Open this page through a local HTTP server.");
  }
  if (typeof loadFallback !== "function") {
    throw new TypeError("A CSV fallback loader must be provided.");
  }

  let manifestResponse;
  try {
    manifestResponse = await fetchImplementation(`${publishedBaseUrl}/active-release.txt`, {
      cache: "no-store",
    });
  } catch (error) {
    return loadCsvFallback(
      loadFallback,
      `Published data could not be checked (${error.message}); showing local preview data, which may be outdated.`,
    );
  }

  if (manifestResponse.status === 404) {
    return loadCsvFallback(loadFallback);
  }
  if (!manifestResponse.ok) {
    return loadCsvFallback(
      loadFallback,
      `Published data could not be checked (HTTP ${manifestResponse.status}); showing local preview data, which may be outdated.`,
    );
  }

  try {
    const releaseId = parseActiveReleaseManifest(
      await responseText(manifestResponse, "Published release manifest"),
    );
    const runsResponse = await fetchImplementation(
      `${publishedBaseUrl}/releases/${releaseId}/runs.json`,
      { cache: "no-store" },
    );
    if (!runsResponse.ok) {
      throw new Error(`active release data request failed with HTTP ${runsResponse.status}`);
    }
    const runsJson = await responseText(runsResponse, "Published runs JSON");
    const runs = validatePublishedRuns(JSON.parse(runsJson));
    return {
      runs,
      source: "published",
      releaseId,
      warning: null,
    };
  } catch (error) {
    return loadCsvFallback(
      loadFallback,
      `Published data is invalid (${error.message}); showing local preview data, which may be outdated.`,
    );
  }
}
