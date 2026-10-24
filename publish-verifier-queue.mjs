import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { projectPublicVerifierRuns } from "./verifier-queue.js";

const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_SOURCE = join(PROJECT_ROOT, "data", "verifier-queue-workbook.json");
export const DEFAULT_OUTPUT = join(PROJECT_ROOT, "data", "verifier-queue-public.json");

export async function publishVerifierQueue({
  sourcePath = DEFAULT_SOURCE,
  outputPath = DEFAULT_OUTPUT,
  overwrite = false,
} = {}) {
  const sourceAbsolutePath = resolve(sourcePath);
  const outputAbsolutePath = resolve(outputPath);
  if (sourceAbsolutePath === outputAbsolutePath) {
    throw new Error("Public verifier output must not overwrite the full local workbook JSON.");
  }

  let source;
  try {
    source = JSON.parse(await readFile(sourceAbsolutePath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read local verifier workbook JSON '${sourceAbsolutePath}': ${error.message}`);
  }

  const publicRuns = projectPublicVerifierRuns(source);
  const contents = `${JSON.stringify(publicRuns)}\n`;
  try {
    await writeFile(outputAbsolutePath, contents, {
      encoding: "utf8",
      flag: overwrite ? "w" : "wx",
    });
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error(`Refusing to overwrite existing public verifier data: ${outputAbsolutePath}`);
    }
    throw new Error(`Could not write public verifier data '${outputAbsolutePath}': ${error.message}`);
  }

  return {
    outputPath: outputAbsolutePath,
    recordCount: publicRuns.length,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const overwrite = args.includes("--overwrite");
  const positionalArgs = args.filter((argument) => argument !== "--overwrite");
  if (positionalArgs.length > 2 || args.some((argument) => (
    argument.startsWith("-") && argument !== "--overwrite"
  ))) {
    throw new Error("Usage: node publish-verifier-queue.mjs [source.json] [output.json] [--overwrite]");
  }

  const result = await publishVerifierQueue({
    sourcePath: positionalArgs[0] ?? DEFAULT_SOURCE,
    outputPath: positionalArgs[1] ?? DEFAULT_OUTPUT,
    overwrite,
  });
  console.log(`Published ${result.recordCount} verifier records to ${result.outputPath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
