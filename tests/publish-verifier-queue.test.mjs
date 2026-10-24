import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { publishVerifierQueue } from "../publish-verifier-queue.mjs";

test("refuses to overwrite an existing public data file by default", async () => {
  const directory = await mkdtemp(join(tmpdir(), "verifier-queue-publish-"));
  const outputPath = join(directory, "public.json");
  const marker = "preserve existing public data\n";

  try {
    await writeFile(outputPath, marker, "utf8");
    await assert.rejects(
      publishVerifierQueue({ outputPath }),
      /Refusing to overwrite existing public verifier data/u,
    );
    assert.equal(await readFile(outputPath, "utf8"), marker);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("refuses to use the local workbook JSON as public output", async () => {
  await assert.rejects(
    publishVerifierQueue({
      sourcePath: ".\\data\\verifier-queue-workbook.json",
      outputPath: ".\\data\\verifier-queue-workbook.json",
    }),
    /must not overwrite the full local workbook JSON/u,
  );
});
