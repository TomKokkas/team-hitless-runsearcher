import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_WORKBOOK = "C:\\Users\\User\\Downloads\\TH Verifier workbook.xlsx";
export const DEFAULT_DATA_OUTPUT = join(PROJECT_ROOT, "data", "verifier-queue-workbook.json");
export const DEFAULT_REPORT_OUTPUT = join(PROJECT_ROOT, "data", "verifier-queue-workbook-report.json");
const REQUIRED_COUNTS = { first_runs: 3009, post_first_runs: 13225 };
const CORE_COLUMNS = ["B", "E", "G", "K"];
const IMPORT_COLUMNS = ["B", "E", "F", "G", "K", "N", "O", "P", "Q"];

function decodeXml(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/giu, (entity, token) => {
    if (token === "amp") return "&";
    if (token === "lt") return "<";
    if (token === "gt") return ">";
    if (token === "quot") return '"';
    if (token === "apos") return "'";
    const codePoint = token[1].toLowerCase() === "x"
      ? Number.parseInt(token.slice(2), 16)
      : Number.parseInt(token.slice(1), 10);
    return String.fromCodePoint(codePoint);
  });
}

function attributes(xml) {
  const result = {};
  for (const match of xml.matchAll(/([^\s=]+)\s*=\s*"([^"]*)"/gu)) {
    result[match[1]] = decodeXml(match[2]);
  }
  return result;
}

function elementBody(xml, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const openTag = new RegExp(`<(?:(?:[\\w.-]+):)?${escapedName}\\b[^>]*>`, "u").exec(xml);
  if (!openTag) return "";
  const openEnd = openTag.index + openTag[0].length;
  const closeTag = new RegExp(`</(?:(?:[\\w.-]+):)?${escapedName}\\s*>`, "u");
  closeTag.lastIndex = openEnd;
  const closeMatch = closeTag.exec(xml);
  return closeMatch ? xml.slice(openEnd, closeMatch.index) : "";
}

function elementText(xml, name) {
  return decodeXml(elementBody(xml, name).replace(/<[^>]*>/gu, ""));
}

function elements(xml, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = new RegExp(`<${escapedName}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/${escapedName}\\s*>)`, "gu");
  return [...xml.matchAll(pattern)].map((match) => ({
    attributes: attributes(match[1]),
    body: match[2] ?? "",
    xml: match[0],
  }));
}

function readZipEntries(buffer) {
  let eocdOffset = -1;
  const scanStart = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= scanStart; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("Workbook is not a valid ZIP/XLSX archive.");

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let offset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = new Map();
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Workbook ZIP central directory is invalid.");
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    if (flags & 1) throw new Error(`Encrypted workbook entry is unsupported: ${name}`);
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`Workbook ZIP entry is invalid: ${name}`);
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    let data;
    if (method === 0) data = compressed;
    else if (method === 8) data = inflateRawSync(compressed);
    else throw new Error(`Unsupported ZIP compression method ${method} in ${name}.`);
    entries.set(name, data.toString("utf8"));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function requiredEntry(entries, name) {
  const value = entries.get(name);
  if (value === undefined) throw new Error(`Workbook is missing required XML entry '${name}'.`);
  return value;
}

function getColumn(reference) {
  return reference.match(/^[A-Z]+/u)?.[0] ?? "";
}

function readCellValue(cell, sharedStrings) {
  const { attributes: attrs, body } = cell;
  const type = attrs.t ?? "";
  if (type === "inlineStr") {
    return elements(body, "t").map((item) => decodeXml(item.body.replace(/<[^>]*>/gu, ""))).join("");
  }
  const rawValue = elementText(body, "v");
  if (!rawValue) return "";
  if (type === "s") {
    const index = Number.parseInt(rawValue, 10);
    if (!Number.isSafeInteger(index) || index < 0 || index >= sharedStrings.length) {
      throw new Error(`Cell '${attrs.r}' has an invalid shared-string index.`);
    }
    return sharedStrings[index];
  }
  if (type === "b") {
    if (rawValue === "1") return "TRUE";
    if (rawValue === "0") return "FALSE";
    throw new Error(`Cell '${attrs.r}' has an invalid boolean value.`);
  }
  return rawValue;
}

function resolveWorksheetPath(target) {
  return target.startsWith("/") ? target.slice(1) : join("xl", target).replaceAll("\\", "/");
}

function classifyStatus({ verifier, dateClaimed, verdict, dateVerified }) {
  const normalizedVerdict = verdict.trim().toLowerCase();
  if (normalizedVerdict === "accepted") return "Accepted";
  if (normalizedVerdict === "rejected") return "Rejected";
  if (normalizedVerdict) return "Needs Review";
  const normalizedVerifier = verifier.trim().toLowerCase();
  if (normalizedVerifier && !["n/a", "na", "none"].includes(normalizedVerifier)) return "Claimed";
  if (!dateClaimed.trim() && !dateVerified.trim()) return "Unclaimed";
  return "Needs Review";
}

const KNOWN_CATEGORIES = [
  "All Bosses & Minibosses",
  "All Bosses + Minibosses",
  "All Bosses + DLC",
  "All Main Game Remembrances",
  "All Beads & Memories",
  "All Divine Beasts",
  "All C-Sides",
  "All Base Game Bosses",
  "All Bosses Base Game",
  "All Bosses Vanilla",
  "All Collectibles",
  "100% All Collectibles",
  "Three Endings",
  "Single Expedition",
  "New Game Pro",
  "Farewell Golden",
  "Challenge 16",
  "Old Souls",
  "Extra Mode",
  "All Isles",
  "All Levels",
  "All Main Game Bosses",
  "All Vanilla Bosses",
  "All Great Runes",
  "All Remembrances",
  "All Memories",
  "All Skills",
  "All Flags",
  "Immortal Severance",
  "Best Ending",
  "True Ending",
  "Purification Ending",
  "All Bosses",
  "Pantheon 5",
  "Mortal Journey",
  "Shura Ending",
  "Purification",
  "Shura",
  "Return Ending",
  "Return",
  "100%",
  "DLC%",
  "DLC",
  "Any%",
  "Any %",
  "P5",
];
const GAME_PREFIX_ALIASES = [
  { pattern: /^(?:dark souls iii|dark souls 3)\b/iu, aliases: ["DS3", "Dark Souls III", "Dark Souls 3"] },
  { pattern: /^(?:dark souls ii|dark souls 2)\b/iu, aliases: ["DS2", "Dark Souls II", "Dark Souls 2"] },
  { pattern: /^dark souls\b/iu, aliases: ["DS1", "Dark Souls 1", "Dark Souls", "Dark Souls I"] },
  { pattern: /^(?:demon'?s souls|demons souls)\b/iu, aliases: ["DeS", "Demon's Souls", "Demons Souls"] },
  { pattern: /^bloodborne\b/iu, aliases: ["BB", "Bloodborne"] },
  { pattern: /^elden ring\b/iu, aliases: ["ER", "Elden Ring"] },
  { pattern: /^sekiro\b/iu, aliases: ["Sekiro"] },
  { pattern: /^hollow knight\b/iu, aliases: ["HK", "Hollow Knight"] },
  { pattern: /^resident evil 2\b/iu, aliases: ["RE2", "Resident Evil 2"] },
  { pattern: /^resident evil 3\b/iu, aliases: ["RE3", "Resident Evil 3"] },
  { pattern: /^resident evil 4\b/iu, aliases: ["RE4", "Resident Evil 4"] },
  { pattern: /^resident evil 7\b/iu, aliases: ["RE7", "Resident Evil 7"] },
  { pattern: /^resident evil 8\b/iu, aliases: ["RE8", "Resident Evil 8"] },
  { pattern: /^hades\b/iu, aliases: ["Hades"] },
];

const KNOWN_RESTRICTIONS = [
  { regex: /\b(?:SL|BL|RL|AP)\s*\d+\b/giu, normalize: (match) => match.replace(/\s+/gu, "").toUpperCase() },
  { regex: /\bNG\s*\+(?!\w)/giu, normalize: () => "NG+" },
  { regex: /\bDamageless\b/giu, normalize: () => "Damageless" },
  { regex: /\bNo\s+Damage\b/giu, normalize: () => "No Damage" },
  { regex: /\b(?:Sorcery|Sorceries)\s+Only\b/giu, normalize: () => "Sorcery Only" },
  { regex: /\bIncantations?\s+Only\b/giu, normalize: () => "Incantations Only" },
  { regex: /\bMiracles?\s+Only\b/giu, normalize: () => "Miracles Only" },
  { regex: /\bMagic\s+Only\b/giu, normalize: () => "Magic Only" },
  { regex: /\bPyromancy\s+Only\b/giu, normalize: () => "Pyromancy Only" },
  { regex: /\bPyro\s+Only\b/giu, normalize: () => "Pyro Only" },
  { regex: /\bMelee\s+Only\b/giu, normalize: () => "Melee Only" },
  {
    regex: /\b(?:Uchigatana|Nail|Peashooter|Black Knight Halberd|Saw Spear|Battle Axe)\s+Only\b/giu,
    normalize: (match) => `${match.replace(/\s+Only$/iu, "")} Only`,
  },
  { regex: /\b(?:Bow|Gun|Sword|Knife|Dagger|Spear|Axe|Halberd)s?\s+Only\b/giu, normalize: (match) => `${match.replace(/\s+Only$/iu, "")} Only` },
  { regex: /\bNo\s+(?:Steel\s+Soul)\b/giu, normalize: () => "No Steel Soul" },
  { regex: /\bNo\s+(?:Quickstep(?:ping)?|Quickstepping)\b/giu, normalize: () => "No Quickstep" },
  { regex: /\bNo\s+(?:Rolling|Roll)\b/giu, normalize: () => "No Roll" },
  { regex: /\bNo\s+(?:Block|Blocking)\b/giu, normalize: () => "No Block" },
  { regex: /\bNo\s+(?:Parry|Parrying)\b/giu, normalize: () => "No Parry" },
  { regex: /\bNo\s+(?:Gun|Guns|Firearms?)\b/giu, normalize: () => "No Guns" },
  { regex: /\bNo\s+Magic\b/giu, normalize: () => "No Magic" },
  { regex: /\bNo\s+(?:Prosthetics?|Prosthetic Tools?)\b/giu, normalize: () => "No Prosthetics" },
  { regex: /\bNo\s+(?:Charms?|Amulets?)\b/giu, normalize: () => "No Charms" },
  { regex: /\bNo\s+(?:Summons?|Summoning)\b/giu, normalize: () => "No Summons" },
  { regex: /\bNo\s+(?:Healing|Heals?)\b/giu, normalize: () => "No Healing" },
  { regex: /\bNo\s+(?:Upgrades?|Infusions?)\b/giu, normalize: () => "No Upgrades" },
  { regex: /\bNo\s+(?:Deaths?|Dying)\b/giu, normalize: () => "No Death" },
  { regex: /\bNo\s+(?:Items?|Item Box)\b/giu, normalize: () => "No Items" },
  { regex: /\bNo\s+(?:Resurrection|Revives?)\b/giu, normalize: () => "No Resurrection" },
  { regex: /\bNo\s+(?:Bonfires?|Checkpoints?)\b/giu, normalize: () => "No Bonfires" },
];

function removeGamePrefix(text, game) {
  const normalizedGame = game.normalize("NFKC").toLowerCase();
  const gameFamily = GAME_PREFIX_ALIASES.find(({ pattern }) => pattern.test(normalizedGame));
  const aliases = [
    ...(gameFamily?.aliases ?? []),
    game,
  ].sort((left, right) => right.length - left.length);
  for (const alias of aliases) {
    const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const match = new RegExp(`^${escapedAlias}(?=$|[\\s:–—-])`, "iu").exec(text);
    if (!match) continue;
    const rest = text.slice(match[0].length).replace(/^[\s:–—-]+/u, "");
    return { text: rest, removed: true };
  }
  return { text, removed: false };
}

function findCategoryMatches(text) {
  const matches = [];
  for (const category of KNOWN_CATEGORIES) {
    const escapedCategory = category.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const regex = new RegExp(`(^|[^\\p{L}\\p{N}])(${escapedCategory})(?=$|[^\\p{L}\\p{N}])`, "giu");
    for (const match of text.matchAll(regex)) {
      matches.push({
        category,
        start: match.index + match[1].length,
        end: match.index + match[1].length + match[2].length,
      });
    }
  }
  return matches
    .sort((left, right) => left.start - right.start || right.category.length - left.category.length)
    .filter((candidate, index, values) => !values.slice(0, index).some((existing) => (
      candidate.start < existing.end && candidate.end > existing.start
    )));
}

function cleanupTitleText(text) {
  return text
    .replace(/\(\s*\)/gu, " ")
    .replace(/[\s,:;|/+\-–—]+$/gu, "")
    .replace(/^[\s,:;|/+\-–—]+/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function removeIntrinsicHitlessTerms(text) {
  return text
    .replace(/\bno[\s-]+hit\b/giu, " ")
    .replace(/\bhitless\b/giu, " ");
}

function extractRestrictions(text) {
  const expandedText = text.replace(
    /\bwithout\s+((?:rolling|roll|quickstepping|quickstep|guns?|firearms?)(?:\s*(?:\/|,|and)\s*(?:rolling|roll|quickstepping|quickstep|guns?|firearms?))*)/giu,
    (_match, list) => {
      const normalizedRestrictions = [];
      for (const item of list.matchAll(/rolling|roll|quickstepping|quickstep|guns?|firearms?/giu)) {
        const normalized = item[0].toLowerCase();
        const restriction = normalized.startsWith("roll") ? "No Roll"
          : normalized.startsWith("quick") ? "No Quickstep" : "No Guns";
        if (!normalizedRestrictions.includes(restriction)) normalizedRestrictions.push(restriction);
      }
      return normalizedRestrictions.join(" ");
    },
  );

  const matches = [];
  for (const { regex, normalize } of KNOWN_RESTRICTIONS) {
    regex.lastIndex = 0;
    for (const match of expandedText.matchAll(regex)) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        value: normalize(match[0]),
      });
    }
  }
  matches.sort((left, right) => left.start - right.start || left.end - right.end);
  const restrictions = [];
  const accepted = [];
  for (const match of matches) {
    if (accepted.some((previous) => match.start < previous.end)) continue;
    accepted.push(match);
    if (!restrictions.includes(match.value)) restrictions.push(match.value);
  }
  let remainder = "";
  let cursor = 0;
  for (const match of accepted) {
    remainder += `${expandedText.slice(cursor, match.start)} `;
    cursor = match.end;
  }
  remainder += expandedText.slice(cursor);

  return {
    text: cleanupTitleText(remainder),
    restrictions: restrictions.join(" / "),
  };
}

export function splitCategory(originalRunText, game = "") {
  const withoutGame = removeGamePrefix(originalRunText.trim(), game);
  const withoutHitless = cleanupTitleText(removeIntrinsicHitlessTerms(withoutGame.text));
  const parsed = extractRestrictions(withoutHitless);
  const withoutRunSuffix = cleanupTitleText(parsed.text.replace(/\b(?:run|speedrun)\b/giu, " "));
  const matches = findCategoryMatches(withoutRunSuffix);
  if (matches.length !== 1) {
    return {
      category: originalRunText,
      restrictions: "",
      reliable: false,
      reason: matches.length === 0 ? "No recognized category phrase" : "Multiple category phrases",
    };
  }

  const match = matches[0];
  const unclassified = cleanupTitleText(
    `${withoutRunSuffix.slice(0, match.start)} ${withoutRunSuffix.slice(match.end)}`,
  );
  if (unclassified) {
    return {
      category: originalRunText,
      restrictions: "",
      reliable: false,
      reason: `Unclassified title text: ${unclassified}`,
    };
  }

  return {
    category: match.category,
    restrictions: parsed.restrictions,
    reliable: true,
    reason: "",
  };
}

function videoUrlProblem(value) {
  if (!value.trim()) return "Missing video URL";
  let url;
  try {
    url = new URL(value);
  } catch {
    return "Not an absolute URL";
  }
  if (!["http:", "https:"].includes(url.protocol)) return "URL scheme is not HTTP or HTTPS";
  if (!url.hostname) return "URL has no host";
  if (url.username || url.password) return "URL contains credentials";
  return "";
}

function readSheetRows(sheetXml, sharedStrings) {
  const sheetData = elementBody(sheetXml, "sheetData");
  const rowPattern = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row\s*>)/gu;
  const result = [];
  for (const rowMatch of sheetData.matchAll(rowPattern)) {
    const rowAttrs = attributes(rowMatch[1]);
    const rowNumber = Number.parseInt(rowAttrs.r, 10);
    if (!Number.isSafeInteger(rowNumber) || rowNumber <= 1) continue;
    const values = Object.fromEntries(IMPORT_COLUMNS.map((column) => [column, ""]));
    const formulaBackedFields = [];
    let hasFormula = false;
    let hasLiteralValue = false;
    const cellPattern = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c\s*>)/gu;
    for (const cellMatch of (rowMatch[2] ?? "").matchAll(cellPattern)) {
      const cell = { attributes: attributes(cellMatch[1]), body: cellMatch[2] ?? "" };
      const column = getColumn(cell.attributes.r ?? "");
      if (!column) continue;
      const formula = /<(?:[\w.-]+:)?f\b[^>]*>/u.test(cell.body);
      const value = readCellValue(cell, sharedStrings);
      if (formula) {
        hasFormula = true;
        if (IMPORT_COLUMNS.includes(column) && value.trim()) formulaBackedFields.push(column);
      } else if (value.trim()) {
        hasLiteralValue = true;
      }
      if (Object.hasOwn(values, column)) values[column] = value;
    }
    result.push({ rowNumber, values, formulaBackedFields, formulaOnlyRow: hasFormula && !hasLiteralValue });
  }
  return result;
}

export async function importVerifierWorkbook(workbookPath = DEFAULT_WORKBOOK) {
  const workbookAbsolutePath = resolve(workbookPath);
  const archiveEntries = readZipEntries(await readFile(workbookAbsolutePath));
  const workbookXml = requiredEntry(archiveEntries, "xl/workbook.xml");
  const relationshipXml = requiredEntry(archiveEntries, "xl/_rels/workbook.xml.rels");
  const relationshipTargets = new Map(
    elements(relationshipXml, "Relationship").map((item) => [
      item.attributes.Id,
      item.attributes.Target,
    ]),
  );
  const sheetTargets = new Map(
    elements(workbookXml, "sheet").map((item) => [
      item.attributes.name,
      relationshipTargets.get(item.attributes["r:id"]),
    ]),
  );
  const sharedStringsXml = archiveEntries.get("xl/sharedStrings.xml");
  const sharedStrings = sharedStringsXml === undefined
    ? []
    : elements(sharedStringsXml, "si").map((item) =>
      elements(item.body, "t")
        .map((text) => decodeXml(text.body.replace(/<[^>]*>/gu, "")))
        .join(""));
  const runs = [];
  const formulaOnlySubmissions = [];
  const partialCoreFieldRows = [];

  for (const sourceSheet of Object.keys(REQUIRED_COUNTS)) {
    const target = sheetTargets.get(sourceSheet);
    if (!target) throw new Error(`Workbook is missing required worksheet '${sourceSheet}'.`);
    const sheetXml = requiredEntry(archiveEntries, resolveWorksheetPath(target));
    for (const { rowNumber, values, formulaBackedFields, formulaOnlyRow } of readSheetRows(sheetXml, sharedStrings)) {
      const presentCore = CORE_COLUMNS.filter((column) => values[column].trim());
      if (!presentCore.length) continue;
      if (presentCore.length !== CORE_COLUMNS.length) {
        partialCoreFieldRows.push({ sourceSheet, row: rowNumber, presentFields: presentCore });
        continue;
      }
      if (formulaOnlyRow) formulaOnlySubmissions.push({ sourceSheet, row: rowNumber });
      const originalRunText = values.G;
      const split = splitCategory(originalRunText, values.E);
      const verification = {
        verifier: values.N,
        dateClaimed: values.O,
        verdict: values.P,
        dateVerified: values.Q,
      };
      runs.push({
        sourceSheet,
        submissionType: sourceSheet === "first_runs" ? "first" : "post",
        row: rowNumber,
        runner: values.B,
        game: values.E,
        runType: values.F,
        originalRunText,
        category: split.category,
        restrictions: split.restrictions,
        categorySplitReliable: split.reliable,
        categorySplitReason: split.reason,
        videoUrl: values.K,
        status: classifyStatus(verification),
        ...verification,
        formulaBackedFields,
        formulaOnlyRow,
      });
    }
  }

  const countsBySheet = Object.fromEntries(
    Object.keys(REQUIRED_COUNTS).map((sheet) => [
      sheet,
      runs.filter((run) => run.sourceSheet === sheet).length,
    ]),
  );
  for (const [sheet, expected] of Object.entries(REQUIRED_COUNTS)) {
    if (countsBySheet[sheet] !== expected) {
      throw new Error(
        `Workbook submission count mismatch: ${sheet}=${countsBySheet[sheet]} (expected ${expected}).`,
      );
    }
  }
  if (partialCoreFieldRows.length) {
    throw new Error(`Found ${partialCoreFieldRows.length} rows with partial core fields.`);
  }

  const statuses = ["Unclaimed", "Claimed", "Accepted", "Rejected", "Needs Review"];
  const countsByStatus = Object.fromEntries(
    statuses.map((status) => [status, runs.filter((run) => run.status === status).length]),
  );
  const problematicVideoUrls = runs.flatMap((run) => {
    const reason = videoUrlProblem(run.videoUrl);
    return reason ? [{
      sourceSheet: run.sourceSheet,
      row: run.row,
      videoUrl: run.videoUrl,
      reason,
    }] : [];
  });
  const needsReviewRecords = runs.filter((run) => run.status === "Needs Review").map((run) => ({
    sourceSheet: run.sourceSheet,
    row: run.row,
    verifier: run.verifier,
    dateClaimed: run.dateClaimed,
    verdict: run.verdict,
    dateVerified: run.dateVerified,
    originalRunText: run.originalRunText,
  }));
  const unreliableCategoryRestrictionsSplits = runs
    .filter((run) => !run.categorySplitReliable)
    .map(({ sourceSheet, row, originalRunText, categorySplitReason }) => ({
      sourceSheet,
      row,
      originalRunText,
      reason: categorySplitReason,
    }));
  const reliableCategoryRestrictionsSplitCount = runs.length
    - unreliableCategoryRestrictionsSplits.length;

  return {
    runs,
    report: {
      sourceWorkbook: workbookAbsolutePath,
      totalSubmissions: runs.length,
      countsBySheet,
      countsByStatus,
      cachedFormulaOnlySubmissionCount: formulaOnlySubmissions.length,
      cachedFormulaOnlySubmissions: formulaOnlySubmissions,
      problematicVideoUrlCount: problematicVideoUrls.length,
      problematicVideoUrls,
      needsReviewCount: needsReviewRecords.length,
      needsReviewRecords,
      reliableCategoryRestrictionsSplitCount,
      unreliableCategoryRestrictionsSplitCount: unreliableCategoryRestrictionsSplits.length,
      unreliableCategoryRestrictionsSplits,
      partialCoreFieldRows,
      duplicatesRemoved: 0,
      googleSheetRowLinksCreated: 0,
    },
  };
}

async function writeOutputFile(path, contents, overwrite) {
  const absolutePath = resolve(path);
  try {
    await readFile(absolutePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeFile(absolutePath, contents, { encoding: "utf8", flag: "wx" });
    return absolutePath;
  }
  if (!overwrite) {
    throw new Error(`Refusing to overwrite existing output file: ${absolutePath}`);
  }
  await writeFile(absolutePath, contents, { encoding: "utf8" });
  return absolutePath;
}

async function main() {
  const args = process.argv.slice(2);
  const overwrite = args.includes("--overwrite");
  const positionalArgs = args.filter((argument) => argument !== "--overwrite");
  const workbookPath = positionalArgs[0] ?? DEFAULT_WORKBOOK;
  const dataPath = positionalArgs[1] ?? DEFAULT_DATA_OUTPUT;
  const reportPath = positionalArgs[2] ?? DEFAULT_REPORT_OUTPUT;
  const result = await importVerifierWorkbook(workbookPath);
  const dataJson = `${JSON.stringify(result.runs, null, 2)}\n`;
  const reportJson = `${JSON.stringify(result.report, null, 2)}\n`;
  const dataAbsolutePath = await writeOutputFile(dataPath, dataJson, overwrite);
  try {
    const reportAbsolutePath = await writeOutputFile(reportPath, reportJson, overwrite);
    console.log(`Imported ${result.report.totalSubmissions} submissions to ${dataAbsolutePath}`);
    console.log(`Import report written to ${reportAbsolutePath}`);
  } catch (error) {
    throw new Error(`Could not write import report after writing data file '${dataAbsolutePath}': ${error.message}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
