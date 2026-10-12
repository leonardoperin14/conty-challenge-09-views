import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { RULE_VERSION, validateViewsInput } from "../src/classifier.js";
import { DEVELOPMENT_SEED, EVALUATION_SEED, generateDataset, type Dataset } from "../src/dataset/generator.js";
import { evaluateDatasets, renderReadmeBlock } from "../src/evaluation.js";

async function readDataset(filename: string): Promise<Dataset> {
  return JSON.parse(await readFile(resolve("data", filename), "utf8")) as Dataset;
}

function assertPublishedMetrics(readme: string, expectedBlock: string): void {
  const publishedBlock = readme.match(/<!-- EVALUATION:START -->[\s\S]*?<!-- EVALUATION:END -->/)?.[0];
  assert.ok(publishedBlock, "README precisa publicar o bloco calculado da avaliação");
  assert.equal(publishedBlock, expectedBlock, "Métricas publicadas divergem das medidas; execute npm run evaluate -- --update-readme");
}

const development = await readDataset("development.json");
const evaluation = await readDataset("evaluation.json");
const measured = evaluateDatasets([development, evaluation], RULE_VERSION);

describe("synthetic dataset and published evaluation", () => {
  it("reproduces both committed datasets from their fixed seeds", async () => {
    assert.deepEqual(development, generateDataset(DEVELOPMENT_SEED));
    assert.deepEqual(evaluation, generateDataset(EVALUATION_SEED));
    assert.equal(development.examples.length, 2_400);
    assert.equal(evaluation.examples.length, 2_400);
    for (const dataset of [development, evaluation]) {
      for (const example of [...dataset.examples, ...dataset.ambiguityCases]) {
        assert.equal(validateViewsInput(example.views), undefined, example.id);
      }
      const families = new Set(dataset.examples.map((example) => example.family));
      assert.ok(families.has("bloco_longo"));
      assert.ok(families.has("bloco_ruidoso"));
      assert.ok(families.has("pico_organico_curto"));
      assert.ok(dataset.examples.some((example) => example.views.length === 720));
    }
  });

  it("keeps the README and report equal to metrics recomputed from the committed datasets", async () => {
    const report = JSON.parse(await readFile(resolve("reports/evaluation.json"), "utf8")) as typeof measured;
    assert.deepEqual(report, measured);

    const readme = await readFile(resolve("README.md"), "utf8");
    assertPublishedMetrics(readme, renderReadmeBlock(measured));
  });

  it("rejects a README whose FPR alone was changed", () => {
    const block = renderReadmeBlock(measured);
    const tampered = block.replace(/(\*\*FPR no holdout:\*\* [^\n]*?= )[\d.]+%/, (_match, prefix: string) => `${prefix}99.99%`);
    assert.notEqual(tampered, block, "O cenário deve alterar somente a taxa publicada");
    assert.throws(() => assertPublishedMetrics(tampered, block), /Métricas publicadas divergem/);
  });

  it("keeps obvious cases correct even if the README and report are regenerated", () => {
    for (const metrics of measured.datasets) {
      assert.equal(metrics.families.viralizacao_explosiva?.falsePositives, 0);
      assert.equal(metrics.families.pico_organico_curto?.falsePositives, 0);
      assert.equal(metrics.families.bloco_mecanico?.suspicious, 200);
      assert.equal(metrics.families.pulsos_repetidos?.suspicious, 150);
      assert.equal(metrics.families.bloco_longo?.suspicious, 100);
      assert.equal(metrics.families.bloco_sem_contexto?.suspicious, 0);
      assert.equal(metrics.families.bloco_curto?.suspicious, 0);
    }
  });

  it("abstains on every declared ambiguity case, including long series and missing context", () => {
    assert.equal(evaluation.ambiguityCases.length, 4);
    assert.deepEqual(evaluation.ambiguityCases[0]?.possibleOrigins, ["viralizacao_organica", "compra_de_views"]);
    for (const metrics of measured.datasets) {
      assert.equal(metrics.ambiguousCases.abstained, metrics.ambiguousCases.total);
    }
  });
});
