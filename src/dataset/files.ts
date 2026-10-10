import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  DEVELOPMENT_SEED,
  EVALUATION_SEED,
  generateDataset,
} from "./generator.js";

export const DATA_DIRECTORY = resolve("data");

export async function writeDatasets(): Promise<void> {
  await mkdir(DATA_DIRECTORY, { recursive: true });
  const datasets = [
    { filename: "development.json", seed: DEVELOPMENT_SEED },
    { filename: "evaluation.json", seed: EVALUATION_SEED },
  ];
  for (const { filename, seed } of datasets) {
    const dataset = generateDataset(seed);
    await writeFile(resolve(DATA_DIRECTORY, filename), `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
  }
}
