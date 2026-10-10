import { classifyViews, type Classification } from "./classifier.js";
import type { Dataset } from "./dataset/generator.js";

export type FamilyMetrics = {
  examples: number;
  suspicious: number;
  inconclusive: number;
  noSuspiciousSignals: number;
  falsePositives: number;
  missedArtificial: number;
};

export type DatasetMetrics = {
  seed: number;
  examples: number;
  legitimate: number;
  artificial: number;
  falsePositives: number;
  falsePositiveRate: number;
  truePositives: number;
  artificialDetectionRate: number;
  legitimateInconclusive: number;
  artificialInconclusive: number;
  families: Record<string, FamilyMetrics>;
  ambiguousCases: { total: number; abstained: number };
  errorExamples: {
    falsePositives: { id: string; family: string }[];
    missedArtificial: { id: string; family: string }[];
  };
};

export type EvaluationReport = {
  ruleVersion: string;
  datasets: DatasetMetrics[];
};

function newFamilyMetrics(): FamilyMetrics {
  return { examples: 0, suspicious: 0, inconclusive: 0, noSuspiciousSignals: 0, falsePositives: 0, missedArtificial: 0 };
}

function incrementPrediction(metrics: FamilyMetrics, classification: Classification): void {
  metrics.examples += 1;
  if (classification === "suspeito") metrics.suspicious += 1;
  else if (classification === "inconclusivo") metrics.inconclusive += 1;
  else metrics.noSuspiciousSignals += 1;
}

export function evaluateDataset(dataset: Dataset): DatasetMetrics {
  let legitimate = 0;
  let artificial = 0;
  let falsePositives = 0;
  let truePositives = 0;
  let legitimateInconclusive = 0;
  let artificialInconclusive = 0;
  const families: Record<string, FamilyMetrics> = {};
  const falsePositiveExamples: { id: string; family: string }[] = [];
  const missedArtificialExamples: { id: string; family: string }[] = [];

  for (const example of dataset.examples) {
    const result = classifyViews(example.views);
    const family = families[example.family] ?? (families[example.family] = newFamilyMetrics());
    incrementPrediction(family, result.classification);

    if (example.label === "legitimate") {
      legitimate += 1;
      if (result.classification === "suspeito") {
        falsePositives += 1;
        family.falsePositives += 1;
        falsePositiveExamples.push({ id: example.id, family: example.family });
      }
      if (result.classification === "inconclusivo") legitimateInconclusive += 1;
    } else {
      artificial += 1;
      if (result.classification === "suspeito") truePositives += 1;
      else {
        family.missedArtificial += 1;
        missedArtificialExamples.push({ id: example.id, family: example.family });
      }
      if (result.classification === "inconclusivo") artificialInconclusive += 1;
    }
  }

  const ambiguousCases = dataset.ambiguityCases ?? [];
  const ambiguousAbstained = ambiguousCases.filter(
    (example) => classifyViews(example.views).classification === example.expectedClassification,
  ).length;

  return {
    seed: dataset.seed,
    examples: dataset.examples.length,
    legitimate,
    artificial,
    falsePositives,
    falsePositiveRate: legitimate === 0 ? 0 : falsePositives / legitimate,
    truePositives,
    artificialDetectionRate: artificial === 0 ? 0 : truePositives / artificial,
    legitimateInconclusive,
    artificialInconclusive,
    families,
    ambiguousCases: { total: ambiguousCases.length, abstained: ambiguousAbstained },
    errorExamples: {
      falsePositives: falsePositiveExamples.slice(0, 5),
      missedArtificial: missedArtificialExamples.slice(0, 5),
    },
  };
}

export function evaluateDatasets(datasets: readonly Dataset[], ruleVersion: string): EvaluationReport {
  return { ruleVersion, datasets: datasets.map(evaluateDataset) };
}

export function renderReadmeBlock(report: EvaluationReport): string {
  const evaluation = report.datasets.find((dataset) => dataset.seed === 20261009);
  const development = report.datasets.find((dataset) => dataset.seed === 20260901);
  if (evaluation === undefined || development === undefined) {
    throw new Error("A avaliação precisa conter as seeds de desenvolvimento e holdout configuradas.");
  }

  const percent = (rate: number): string => `${(rate * 100).toFixed(2)}%`;
  const rows = report.datasets.map((dataset) =>
    `| ${dataset.seed === 20260901 ? "Desenvolvimento" : "Holdout"} | ${dataset.seed} | ${dataset.examples} | ${dataset.legitimate} | ${dataset.falsePositives} | ${percent(dataset.falsePositiveRate)} | ${dataset.artificial} | ${dataset.truePositives} | ${percent(dataset.artificialDetectionRate)} | ${dataset.legitimateInconclusive} | ${dataset.artificialInconclusive} |`,
  );
  const familyRows = Object.entries(evaluation.families).map(([family, metrics]) =>
    `| ${family} | ${metrics.examples} | ${metrics.falsePositives} | ${metrics.missedArtificial} | ${metrics.inconclusive} |`,
  );
  const falsePositiveExamples = evaluation.errorExamples.falsePositives.length === 0
    ? "nenhum"
    : evaluation.errorExamples.falsePositives.map((example) => `${example.id} (${example.family})`).join(", ");
  const missedExamples = evaluation.errorExamples.missedArtificial.length === 0
    ? "nenhum"
    : evaluation.errorExamples.missedArtificial.map((example) => `${example.id} (${example.family})`).join(", ");

  return [
    "<!-- EVALUATION:START -->",
    `Regras avaliadas: **${report.ruleVersion}**. Resultado calculado pelo comando \`npm run evaluate\`; as taxas abaixo vêm dos exemplos sintéticos identificados por seed.`,
    "",
    "| Conjunto | Seed | Séries | Legítimas | Falsos positivos | FPR | Artificiais | Sinalizadas | Detecção artificial | Legítimas inconclusivas | Artificiais inconclusivas |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...rows,
    "",
    `**FPR no holdout:** ${evaluation.falsePositives}/${evaluation.legitimate} = ${percent(evaluation.falsePositiveRate)}. **Detecção artificial:** ${evaluation.truePositives}/${evaluation.artificial} = ${percent(evaluation.artificialDetectionRate)}. Inconclusivos não contam como falso positivo nem como detecção.`,
    `**Casos de origem ambígua:** ${evaluation.ambiguousCases.abstained}/${evaluation.ambiguousCases.total} receberam a abstenção esperada; eles não entram no denominador da FPR por não terem rótulo único de origem.`,
    "",
    "**Holdout por família** (falsos positivos em legítimas; artificiais não detectados; inconclusivos):",
    "",
    "| Família | Séries | Falsos positivos | Artificiais não detectados | Inconclusivos |",
    "|---|---:|---:|---:|---:|",
    ...familyRows,
    "",
    `Exemplos de falsos positivos: ${falsePositiveExamples}. Exemplos de artificiais não detectados: ${missedExamples}. Os detalhes completos estão em \`reports/evaluation.json\`.`,
    "<!-- EVALUATION:END -->",
  ].join("\n");
}
