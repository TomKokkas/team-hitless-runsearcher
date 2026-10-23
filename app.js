import { loadRunData } from "./published-data.js";

export const CSV_HEADERS = ["Runner", "Game", "Category", "Run name", "Run link"];

const SEARCH_FIELDS = ["runner", "game", "category", "runName"];
const GAME_ALIAS_GROUPS = [
  {
    canonical: "Dark Souls",
    aliases: ["Dark Souls", "Dark Souls I", "Dark Souls 1"],
  },
  {
    canonical: "Dark Souls II",
    aliases: ["Dark Souls II", "Dark Souls 2"],
  },
  {
    canonical: "Dark Souls III",
    aliases: [
      "Dark Souls III",
      "Dark Souls 3",
      "Dark Soul III",
      "Dark Soul 3",
      "Darks Souls III",
      "Darks Souls 3",
    ],
  },
  {
    canonical: "Crash Bandicoot 2: Cortex Strikes Back",
    aliases: [
      "Crash Bandicoot 2",
      "Crash Bandicoot 2: Cortex Strike Back",
      "Crash Bandicoot 2: Cortex Strikes Back",
    ],
  },
  {
    canonical: "Demon's Souls",
    aliases: [
      "Demon's Souls",
      "Demon's Souls Classic",
      "Demon's Souls: Classic",
      "Demon's Souls Remake",
      "Demon's Souls: Remake",
      "Demons' Souls",
    ],
  },
  {
    canonical: "Dishonored: Death of the Outsider",
    aliases: [
      "Dishonored: Death of the Outsider",
      "Dishonored : Death Of The Outsider",
    ],
  },
  {
    canonical: "Multiple",
    aliases: ["Multiple", "Mult Runs", "Multi Run", "Multi Runs", "Multple"],
  },
];

const CATEGORY_ALIAS_GROUPS = [
  {
    canonical: "All Achievements",
    aliases: ["All Achievements"],
  },
  {
    canonical: "All Beads & Memories",
    aliases: ["All Beads & Memories", "All Beads + Memories"],
  },
  {
    canonical: "All Bosses",
    aliases: ["All Bosses"],
  },
  {
    canonical: "All Bosses + Minibosses",
    aliases: [
      "All Bosses + Minibosses",
      "All Bosses & Minibosses",
      "All Bosses and Minibosses",
    ],
  },
  {
    canonical: "All Main Game Bosses",
    aliases: ["All Main Game Bosses", "All Main Games Bosses"],
  },
  {
    canonical: "All Memories",
    aliases: ["All Memories"],
  },
  {
    canonical: "All Remembrances",
    aliases: ["All Remembrances"],
  },
  {
    canonical: "Any%",
    aliases: ["Any%", "Any %"],
  },
  {
    canonical: "Expert DLC Any%",
    aliases: ["Expert DLC Any%"],
  },
  {
    canonical: "Expert All Flags",
    aliases: ["Expert All Flags", "Exper All Flags"],
  },
  {
    canonical: "Immortal Severance",
    aliases: ["Immortal Severance"],
  },
  {
    canonical: "Multi-Runs",
    aliases: ["Multi-Runs", "Mulit-Runs"],
  },
  {
    canonical: "Real Survival",
    aliases: ["Real Survival", "Real Surival"],
  },
  {
    canonical: "Return",
    aliases: ["Return"],
  },
  {
    canonical: "Shura",
    aliases: ["Shura"],
  },
  {
    canonical: "Shura Ending",
    aliases: ["Shura Ending", "Shura Ending Ending"],
  },
];

const KNOWN_GAME_TITLES = [
  "Blasphemous",
  "Bloodborne",
  "Celeste",
  "Crash Bandicoot",
  "Crash Bandicoot 3: Warped",
  "Crash Bandicoot 4: It's About Time",
  "Cuphead",
  "Dark Souls",
  "Dark Souls II",
  "Dark Souls III",
  "Demon's Souls",
  "Dishonored",
  "Dishonored 2",
  "Dishonored: Death of the Outsider",
  "Elden Ring",
  "Hades",
  "Hollow Knight",
  "Low%",
  "Multiple",
  "Resident Evil 0",
  "Resident Evil 2 Classic",
  "Resident Evil 2 Remake",
  "Resident Evil 3 Classic",
  "Resident Evil 3 Remake",
  "Resident Evil 4 Classic",
  "Resident Evil 4 Remake",
  "Resident Evil 7",
  "Resident Evil Classic",
  "Resident Evil Code: Veronica",
  "Resident Evil Remake",
  "Resident Evil Survivor",
  "Resident Evil Village",
  "Sekiro",
  "Shura",
  "Silent Hill",
  "Silent Hill 2",
  "Silent Hill 3",
  "Silent Hill 4",
  "Tormented Souls",
  "Zelda: Breath of the Wild",
  "Zelda: Tears of the Kingdom",
];

function cleanGameName(value) {
  return value.normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .trim()
    .replace(/\s+/gu, " ");
}

function gameNameKey(value) {
  return cleanGameName(value).toLowerCase().replace(/[’]/gu, "'");
}

const canonicalGameNames = new Map(
  KNOWN_GAME_TITLES.map((title) => [gameNameKey(title), title]),
);
for (const group of GAME_ALIAS_GROUPS) {
  for (const alias of group.aliases) {
    canonicalGameNames.set(gameNameKey(alias), group.canonical);
  }
}

export function normalizeGameName(value) {
  const cleaned = cleanGameName(value);
  return canonicalGameNames.get(gameNameKey(cleaned)) ?? cleaned;
}

function cleanCategoryName(value) {
  return value.normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .trim()
    .replace(/\s+/gu, " ");
}

function categoryNameKey(value) {
  return cleanCategoryName(value).toLowerCase();
}

const canonicalCategoryNames = new Map();
for (const group of CATEGORY_ALIAS_GROUPS) {
  for (const alias of group.aliases) {
    canonicalCategoryNames.set(categoryNameKey(alias), group.canonical);
  }
}

function capitalizationScore(value) {
  return [...value].filter((character) => character.toLocaleUpperCase() === character
      && character.toLocaleLowerCase() !== character).length;
}

function createCategoryNormalizer(knownCategories = []) {
  const candidateCounts = new Map();
  for (const category of knownCategories) {
    const candidate = cleanCategoryName(category ?? "");
    if (!candidate) {
      continue;
    }
    const key = categoryNameKey(candidate);
    const candidates = candidateCounts.get(key) ?? new Map();
    candidates.set(candidate, (candidates.get(candidate) ?? 0) + 1);
    candidateCounts.set(key, candidates);
  }

  const preferredNames = new Map();
  for (const [key, candidates] of candidateCounts) {
    preferredNames.set(key, [...candidates]
      .sort(([leftName, leftCount], [rightName, rightCount]) => rightCount - leftCount
        || capitalizationScore(rightName) - capitalizationScore(leftName)
        || leftName.localeCompare(rightName, undefined, { sensitivity: "base" }))[0][0]);
  }

  return (value) => {
    const cleaned = cleanCategoryName(value);
    const key = categoryNameKey(cleaned);
    return canonicalCategoryNames.get(key) ?? preferredNames.get(key) ?? cleaned;
  };
}

export function normalizeCategoryName(value, knownCategories = []) {
  return createCategoryNormalizer(knownCategories)(value);
}

function gameSearchNames(value) {
  const canonical = normalizeGameName(value);
  return [cleanedSearchName(value), cleanedSearchName(canonical)];
}

function cleanedSearchName(value) {
  return normalizeSearchText(cleanGameName(value));
}

export function parseCsv(csvText) {
  if (typeof csvText !== "string") {
    throw new TypeError("CSV input must be text.");
  }

  const text = csvText.charCodeAt(0) === 0xfeff ? csvText.slice(1) : csvText;
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let quoteClosed = false;

  for (let index = 0; index < text.length; index++) {
    const character = text[index];

    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          inQuotes = false;
          quoteClosed = true;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (quoteClosed && character !== "," && character !== "\n" && character !== "\r") {
      throw new Error(`Unexpected character after a quoted CSV field at character ${index + 1}.`);
    }
    if (character === '"' && field.length === 0 && !quoteClosed) {
      inQuotes = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
      quoteClosed = false;
    } else if (character === "\n" || character === "\r") {
      row.push(field);
      field = "";
      quoteClosed = false;
      rows.push(row);
      row = [];
      if (character === "\r" && text[index + 1] === "\n") {
        index++;
      }
    } else if (character === '"') {
      throw new Error(`Unexpected quote in unquoted CSV field at character ${index + 1}.`);
    } else {
      field += character;
    }
  }

  if (inQuotes) {
    throw new Error("CSV contains an unterminated quoted field.");
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  while (rows.length > 0 && rows.at(-1).every((value) => value === "")) {
    rows.pop();
  }
  if (rows.length === 0) {
    throw new Error("CSV is empty.");
  }

  const headers = rows.shift();
  if (headers.length !== CSV_HEADERS.length
      || headers.some((header, index) => header !== CSV_HEADERS[index])) {
    throw new Error(`CSV headers must be exactly: ${CSV_HEADERS.join(",")}.`);
  }

  return rows.map((values, index) => {
    if (values.length !== CSV_HEADERS.length) {
      throw new Error(`CSV record ${index + 2} has ${values.length} fields; expected ${CSV_HEADERS.length}.`);
    }
    return {
      runner: values[0],
      game: values[1],
      category: values[2],
      runName: values[3],
      runLink: values[4],
    };
  });
}

function normalizeSearchText(value) {
  return value
    .toLowerCase()
    .replace(/[’']/gu, "")
    .normalize("NFKC");
}

export function filterRuns(runs, { query = "", game = "", category = "" } = {}) {
  const cleanedQuery = cleanGameName(query);
  const queryGame = canonicalGameNames.get(gameNameKey(cleanedQuery));
  const hasDemonSoulsEdition = /\b(classic|remake)\b/iu.test(cleanedQuery);
  const terms = normalizeSearchText(query).trim().split(/\s+/u).filter(Boolean);
  const knownCategories = runs.map((run) => run.category ?? "");
  const normalizeCategory = createCategoryNormalizer(knownCategories);
  return runs.filter((run) => {
    if (game && gameNameKey(normalizeGameName(run.game)) !== gameNameKey(normalizeGameName(game))) {
      return false;
    }
    if (category && categoryNameKey(normalizeCategory(run.category))
        !== categoryNameKey(normalizeCategory(category))) {
      return false;
    }
    if (terms.length === 0) {
      return true;
    }
    if (queryGame && !hasDemonSoulsEdition
        && gameNameKey(normalizeGameName(run.game)) === gameNameKey(queryGame)) {
      return true;
    }
    const searchableValues = SEARCH_FIELDS.flatMap((key) => key === "game"
      ? gameSearchNames(run.game)
      : key === "category"
        ? [normalizeSearchText(cleanCategoryName(run.category ?? "")),
        normalizeSearchText(normalizeCategory(run.category ?? ""))]
      : [normalizeSearchText(run[key] ?? "")]);
    return terms.every((term) => searchableValues.some((value) => value.includes(term)));
  });
}

export function availableOptions(runs, field, game = "") {
  const source = field === "category" && game
    ? runs.filter((run) => gameNameKey(normalizeGameName(run.game))
      === gameNameKey(normalizeGameName(game)))
    : runs;
  if (field === "game") {
    const titlesByKey = new Map();
    for (const run of source) {
      const displayName = normalizeGameName(run.game);
      titlesByKey.set(gameNameKey(displayName), titlesByKey.get(gameNameKey(displayName)) ?? displayName);
    }
    return [...titlesByKey.values()]
      .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
  }
  if (field === "category") {
    const knownCategories = runs.map((run) => run.category ?? "");
    const normalizeCategory = createCategoryNormalizer(knownCategories);
    const categoriesByKey = new Map();
    for (const run of source) {
      if (!run.category) {
        continue;
      }
      const displayName = normalizeCategory(run.category);
      categoriesByKey.set(categoryNameKey(displayName),
        categoriesByKey.get(categoryNameKey(displayName)) ?? displayName);
    }
    return [...categoriesByKey.values()]
      .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
  }
  const values = source.map((run) => run[field]);
  return [...new Set(values.filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
}

function safeRunUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function makeCell(label, value) {
  const cell = document.createElement("td");
  cell.dataset.label = label;
  cell.textContent = value;
  return cell;
}

function renderRows(runs, body, knownCategories) {
  const fragment = document.createDocumentFragment();
  const normalizeCategory = createCategoryNormalizer(knownCategories);
  for (const run of runs) {
    const row = document.createElement("tr");
    row.append(
      makeCell("Runner", run.runner),
      makeCell("Game", normalizeGameName(run.game)),
      makeCell("Category", normalizeCategory(run.category)),
      makeCell("Run name", run.runName),
    );

    const linkCell = document.createElement("td");
    linkCell.dataset.label = "Run link";
    const url = safeRunUrl(run.runLink);
    if (url) {
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = run.runLink;
      linkCell.append(link);
    } else {
      linkCell.textContent = run.runLink;
    }
    row.append(linkCell);
    fragment.append(row);
  }
  body.replaceChildren(fragment);
}

function setOptions(select, values, allLabel, selectedValue = "") {
  const fragment = document.createDocumentFragment();
  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = allLabel;
  fragment.append(allOption);

  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    fragment.append(option);
  }
  select.replaceChildren(fragment);
  select.value = values.includes(selectedValue) ? selectedValue : "";
}

export async function loadRuns(url = "./data/runs.csv", fetchImplementation = globalThis.fetch) {
  if (typeof fetchImplementation !== "function") {
    throw new Error("Fetch is unavailable. Open this page through a local HTTP server.");
  }
  const response = await fetchImplementation(url);
  if (!response.ok) {
    throw new Error(`Could not load preview data (${response.status} ${response.statusText}).`);
  }
  return parseCsv(await response.text());
}

function initializePage() {
  const searchInput = document.querySelector("#search-input");
  const gameFilter = document.querySelector("#game-filter");
  const categoryFilter = document.querySelector("#category-filter");
  const clearButton = document.querySelector("#clear-filters");
  const resultCount = document.querySelector("#result-count");
  const loadError = document.querySelector("#load-error");
  const dataSource = document.querySelector("#data-source");
  const emptyState = document.querySelector("#empty-state");
  const runsBody = document.querySelector("#runs-body");
  let runs = [];

  const refresh = () => {
    const gameOptions = availableOptions(runs, "game");
    setOptions(gameFilter, gameOptions, "All games", gameFilter.value);
    const categoryOptions = availableOptions(runs, "category", gameFilter.value);
    setOptions(categoryFilter, categoryOptions, "All categories", categoryFilter.value);
    const results = filterRuns(runs, {
      query: searchInput.value,
      game: gameFilter.value,
      category: categoryFilter.value,
    });
    renderRows(results, runsBody, runs.map((run) => run.category));
    resultCount.textContent = `${results.length.toLocaleString()} ${results.length === 1 ? "run" : "runs"}`;
    emptyState.hidden = results.length > 0;
  };

  searchInput.addEventListener("input", refresh);
  gameFilter.addEventListener("change", refresh);
  categoryFilter.addEventListener("change", refresh);
  clearButton.addEventListener("click", () => {
    searchInput.value = "";
    gameFilter.value = "";
    categoryFilter.value = "";
    refresh();
    searchInput.focus();
  });

  loadRunData({ loadFallback: () => loadRuns() })
    .then((data) => {
      runs = data.runs;
      dataSource.textContent = data.source === "published"
        ? "Published data"
        : "Older local CSV preview";
      if (data.warning) {
        loadError.textContent = data.warning;
        loadError.hidden = false;
      }
      refresh();
    })
    .catch((error) => {
      resultCount.textContent = "Data unavailable";
      loadError.textContent = `${error.message} Start a local HTTP server from the project root and reload.`;
      loadError.hidden = false;
      dataSource.textContent = "Data unavailable";
      emptyState.hidden = false;
      emptyState.textContent = "Runs could not be loaded.";
    });
}

if (typeof document !== "undefined") {
  initializePage();
}
