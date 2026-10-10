import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { classifyViews, RULE_VERSION } from "../classifier.js";
import { evaluateDatasets, renderReadmeBlock } from "../evaluation.js";
import { DEVELOPMENT_SEED, EVALUATION_SEED, generateDataset } from "../dataset/generator.js";
import { writeDatasets } from "../dataset/files.js";

await writeDatasets();
await mkdir(resolve("reports"), { recursive: true });

const datasets = [generateDataset(DEVELOPMENT_SEED), generateDataset(EVALUATION_SEED)];
const report = evaluateDatasets(datasets, RULE_VERSION);
await writeFile(resolve("reports/evaluation.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

const readmeBlock = renderReadmeBlock(report);
console.log(readmeBlock);

if (process.argv.includes("--update-readme")) {
  const readmePath = resolve("README.md");
  const currentReadme = await readFile(readmePath, "utf8");
  const blockPattern = /<!-- EVALUATION:START -->[\s\S]*?<!-- EVALUATION:END -->/;
  if (!blockPattern.test(currentReadme)) {
    throw new Error("README.md precisa conter os marcadores EVALUATION:START e EVALUATION:END.");
  }
  await writeFile(readmePath, currentReadme.replace(blockPattern, readmeBlock), "utf8");
  console.log("Bloco de métricas do README atualizado com os valores calculados.");
}

const allAbstentionsPassed = report.datasets.every((metrics) =>
  metrics.ambiguousCases.abstained === metrics.ambiguousCases.total,
);
if (!allAbstentionsPassed) {
  console.error("Falha: um caso sintético de origem ambígua não recebeu a abstenção esperada.");
  process.exitCode = 1;
}

// Keep a direct guard that the generated ambiguous scenario stays in the inconclusive bucket.
for (const dataset of datasets) {
  for (const ambiguous of dataset.ambiguityCases) {
    if (classifyViews(ambiguous.views).classification !== ambiguous.expectedClassification) {
      process.exitCode = 1;
    }
  }
}
