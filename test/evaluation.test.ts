import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { RULE_VERSION } from "../src/classifier.js";
import { DEVELOPMENT_SEED, EVALUATION_SEED, generateDataset, type Dataset } from "../src/dataset/generator.js";
import { evaluateDatasets, renderReadmeBlock } from "../src/evaluation.js";

async function readDataset(filename: string): Promise<Dataset> {
  return JSON.parse(await readFile(resolve("data", filename), "utf8")) as Dataset;
}

describe("synthetic dataset and published evaluation", () => {
  it("reproduces both committed datasets from their fixed seeds", async () => {
    const development = await readDataset("development.json");
    const evaluation = await readDataset("evaluation.json");
    assert.deepEqual(development, generateDataset(DEVELOPMENT_SEED));
    assert.deepEqual(evaluation, generateDataset(EVALUATION_SEED));
    assert.equal(development.examples.length, 1_500);
    assert.equal(evaluation.examples.length, 1_500);
  });

  it("keeps the README and report equal to metrics recomputed from the committed datasets", async () => {
    const development = await readDataset("development.json");
    const evaluation = await readDataset("evaluation.json");
    const measured = evaluateDatasets([development, evaluation], RULE_VERSION);
    const report = JSON.parse(await readFile(resolve("reports/evaluation.json"), "utf8")) as typeof measured;
    assert.deepEqual(report, measured);

    const readme = await readFile(resolve("README.md"), "utf8");
    const publishedBlock = readme.match(/<!-- EVALUATION:START -->[\s\S]*?<!-- EVALUATION:END -->/)?.[0];
    assert.ok(publishedBlock, "README precisa publicar o bloco calculado da avaliação");
    assert.equal(publishedBlock, renderReadmeBlock(measured));
  });

  it("abstains on the unlabeled burst that is compatible with either origin", async () => {
    const evaluation = await readDataset("evaluation.json");
    assert.equal(evaluation.ambiguityCases.length, 1);
    assert.deepEqual(evaluation.ambiguityCases[0]?.possibleOrigins, ["viralizacao_organica", "compra_de_views"]);
    const metrics = evaluateDatasets([evaluation], RULE_VERSION).datasets[0]!;
    assert.equal(metrics.ambiguousCases.abstained, metrics.ambiguousCases.total);
  });
});
