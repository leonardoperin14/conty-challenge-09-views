export type SyntheticLabel = "legitimate" | "artificial";

export type SyntheticExample = {
  id: string;
  label: SyntheticLabel;
  family: string;
  views: number[];
};

export type Dataset = {
  schemaVersion: 1;
  seed: number;
  examples: SyntheticExample[];
  ambiguityCases: {
    id: string;
    possibleOrigins: string[];
    expectedClassification: "inconclusivo";
    views: number[];
  }[];
};

export const DEVELOPMENT_SEED = 20260901;
export const EVALUATION_SEED = 20261009;

const LENGTHS = [48, 72, 168] as const;
const BASE_SCALES = [15, 60, 240, 1_000, 4_000, 15_000] as const;

class Random {
  private state: number;
  private spareNormal: number | undefined;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  }

  integer(minimum: number, maximum: number): number {
    return minimum + Math.floor(this.next() * (maximum - minimum + 1));
  }

  pick<T>(values: readonly T[]): T {
    return values[this.integer(0, values.length - 1)]!;
  }

  normal(): number {
    if (this.spareNormal !== undefined) {
      const value = this.spareNormal;
      this.spareNormal = undefined;
      return value;
    }
    const first = Math.max(Number.EPSILON, this.next());
    const second = this.next();
    const magnitude = Math.sqrt(-2 * Math.log(first));
    this.spareNormal = magnitude * Math.sin(2 * Math.PI * second);
    return magnitude * Math.cos(2 * Math.PI * second);
  }
}

function roundedCount(value: number): number {
  return Math.max(0, Math.round(value));
}

function withDayCycle(value: number, hour: number, phase: number, strength = 0.18): number {
  return value * (1 + strength * Math.sin((2 * Math.PI * hour) / 24 + phase));
}

function generateLegitimate(family: string, length: number, random: Random): { family: string; views: number[] } {
  const scale = random.pick(BASE_SCALES);
  const phase = random.next() * 2 * Math.PI;

  if (family === "divulgacao_externa" && random.next() < 0.15) {
    const duration = random.integer(8, 16);
    const start = random.integer(4, length - duration - 4);
    const campaignMean = random.pick([3_000, 12_000, 50_000, 200_000]);
    const jitter = 0.005 + random.next() * 0.055;
    const views = Array.from({ length }, (_, hour) => {
      if (hour >= start && hour < start + duration) {
        return roundedCount(campaignMean * Math.exp(random.normal() * jitter));
      }
      return roundedCount(campaignMean * (0.01 + random.next() * 0.07));
    });
    return { family: "campanha_autorizada_regular", views };
  }

  if (family === "crescimento_gradual") {
    const start = scale * random.integer(1, 4);
    const end = start * random.integer(2, 8);
    return { family, views: Array.from({ length }, (_, hour) => {
      const progress = hour / Math.max(1, length - 1);
      const trend = start * (1 - progress) + end * progress;
      return roundedCount(withDayCycle(trend * Math.exp(random.normal() * 0.16), hour, phase, 0.12));
    }) };
  }

  if (family === "viralizacao_explosiva") {
    const peakHour = random.integer(3, length - 4);
    const amplitude = scale * random.integer(8, 40);
    const width = random.integer(5, 14);
    return { family, views: Array.from({ length }, (_, hour) => {
      const distance = (hour - peakHour) / width;
      const viralPulse = amplitude * Math.exp(-0.5 * distance * distance);
      const background = scale * 0.15;
      return roundedCount(withDayCycle((background + viralPulse) * Math.exp(random.normal() * 0.13), hour, phase));
    }) };
  }

  if (family === "ondas_organicas") {
    const waveCount = random.integer(2, 3);
    const waves = Array.from({ length: waveCount }, () => ({
      center: random.integer(3, length - 4),
      amplitude: scale * random.integer(3, 16),
      width: random.integer(5, 18),
    }));
    return { family, views: Array.from({ length }, (_, hour) => {
      const total = scale * 0.12 + waves.reduce((sum, wave) => {
        const distance = (hour - wave.center) / wave.width;
        return sum + wave.amplitude * Math.exp(-0.5 * distance * distance);
      }, 0);
      return roundedCount(withDayCycle(total * Math.exp(random.normal() * 0.18), hour, phase));
    }) };
  }

  if (family === "divulgacao_externa") {
    const center = random.integer(4, length - 5);
    const amplitude = scale * random.integer(8, 50);
    const width = random.integer(3, 9);
    return { family, views: Array.from({ length }, (_, hour) => {
      const distance = (hour - center) / width;
      const pulse = amplitude * Math.exp(-0.5 * distance * distance);
      return roundedCount(withDayCycle((scale * 0.08 + pulse) * Math.exp(random.normal() * 0.2), hour, phase));
    }) };
  }

  // A correlated walk makes low volume and irregular series vary without creating a fixed template.
  let drift = 0;
  return { family, views: Array.from({ length }, (_, hour) => {
    drift = 0.55 * drift + random.normal() * 0.34;
    const value = scale * (0.65 + Math.max(-0.5, drift)) * (1 + 0.22 * Math.sin((2 * Math.PI * hour) / 24 + phase));
    return roundedCount(value);
  }) };
}

function generatePlateau(length: number, random: Random): number[] {
  const duration = random.integer(8, 24);
  const start = random.integer(4, length - duration - 4);
  const plateauMean = random.pick([200, 600, 2_000, 10_000, 50_000, 250_000]);
  const views = Array.from({ length }, () => roundedCount(plateauMean * 0.08 * random.next()));
  for (let hour = start; hour < start + duration; hour += 1) {
    views[hour] = roundedCount(plateauMean * (1 + (random.next() - 0.5) * 0.018));
  }
  return views;
}

function generateRepeatedPulses(length: number, random: Random): number[] {
  const period = random.integer(2, 12);
  const duration = period * 4;
  const start = random.integer(0, length - duration);
  const peakPhase = random.integer(0, period - 1);
  const base = random.integer(10, 70);
  const peak = base * random.integer(30, 500);
  const template = Array.from({ length: period }, (_, phase) => phase === peakPhase ? peak : base + random.integer(0, 2));
  const views = Array.from({ length }, () => base + random.integer(0, Math.max(1, Math.floor(base * 0.8))));
  for (let cycle = 0; cycle < 4; cycle += 1) {
    for (let phase = 0; phase < period; phase += 1) {
      const expected = template[phase]!;
      const jitter = phase === peakPhase ? (random.next() - 0.5) * 0.012 : (random.next() - 0.5) * 0.25;
      views[start + cycle * period + phase] = roundedCount(expected * (1 + jitter));
    }
  }
  return views;
}

function generateIsolatedSpike(length: number, random: Random): number[] {
  const base = random.integer(15, 100);
  const views = Array.from({ length }, () => roundedCount(base * (0.65 + random.next() * 0.7)));
  const hour = random.integer(5, length - 6);
  views[hour] = base * random.integer(100, 1_000);
  return views;
}

function generateCamouflagedGrowth(length: number, random: Random): number[] {
  const start = random.integer(25, 100);
  const factor = random.integer(2, 5);
  return Array.from({ length }, (_, hour) => {
    const progress = hour / Math.max(1, length - 1);
    const trend = start * (1 + progress * (factor - 1));
    return roundedCount(trend * Math.exp(random.normal() * 0.12));
  });
}

// Stress scenarios intentionally include durations, noise and periods outside
// the original easy examples. This module never imports classifier thresholds.
function generateStressBlock(random: Random, kind: "long" | "short" | "noisy" | "boundary" | "authorized"): number[] {
  const duration = kind === "short" ? random.integer(4, 7)
    : kind === "noisy" ? random.integer(10, 72)
      : kind === "boundary" ? random.integer(8, 120)
        : random.pick([25, 48, 96, 168, 360, 672]);
  const before = kind === "boundary" && random.next() < 0.5 ? 0 : random.integer(8, 24);
  const after = kind === "boundary" && before > 0 ? 0 : random.integer(8, 24);
  const mean = random.pick([200, 1_000, 10_000, 100_000]);
  const noise = kind === "noisy" ? 0.021 + random.next() * 0.099
    : kind === "authorized" ? 0.005 + random.next() * 0.075 : 0.005;
  return Array.from({ length: before + duration + after }, (_, hour) => {
    const inBlock = hour >= before && hour < before + duration;
    return roundedCount(inBlock ? mean * Math.exp(random.normal() * noise) : mean * (0.01 + random.next() * 0.04));
  });
}

function generateStressPulses(random: Random, outsideRange: boolean): number[] {
  const period = outsideRange ? random.integer(13, 24) : random.integer(2, 12);
  const cycles = random.integer(3, 6);
  const base = random.integer(10, 70);
  const peak = base * random.integer(30, 300);
  const phase = random.integer(0, period - 1);
  const jitter = outsideRange ? 0.005 : 0.04 + random.next() * 0.14;
  return Array.from({ length: period * cycles + 24 }, (_, hour) => {
    if (hour >= 12 && hour < 12 + period * cycles && (hour - 12) % period === phase) {
      return roundedCount(peak * Math.exp(random.normal() * jitter));
    }
    return roundedCount(base * (0.8 + random.next() * 0.4));
  });
}

function generateDailySeasonality(random: Random): number[] {
  const length = random.pick([72, 168, 720]);
  const scale = random.pick(BASE_SCALES);
  const phase = random.integer(0, 23);
  return Array.from({ length }, (_, hour) => {
    const distance = Math.min((hour + phase) % 24, 24 - (hour + phase) % 24);
    return roundedCount(scale * (0.1 + 12 * Math.exp(-0.5 * (distance / 2.5) ** 2)) * Math.exp(random.normal() * 0.15));
  });
}

export function generateDataset(seed: number): Dataset {
  const random = new Random(seed);
  const examples: SyntheticExample[] = [];
  const legitimateFamilies = [
    "crescimento_gradual",
    "viralizacao_explosiva",
    "ondas_organicas",
    "divulgacao_externa",
    "baixo_volume_irregular",
  ] as const;

  for (const family of legitimateFamilies) {
    for (let index = 0; index < 200; index += 1) {
      const length = random.pick(LENGTHS);
      const generated = generateLegitimate(family, length, random);
      examples.push({
        id: `legitimate-${generated.family}-${String(index + 1).padStart(3, "0")}`,
        label: "legitimate",
        family: generated.family,
        views: generated.views,
      });
    }
  }

  const artificialFamilies = [
    { family: "bloco_mecanico", count: 200, generate: generatePlateau },
    { family: "pulsos_repetidos", count: 150, generate: generateRepeatedPulses },
    { family: "pico_isolado", count: 100, generate: generateIsolatedSpike },
    { family: "crescimento_disfarcado", count: 50, generate: generateCamouflagedGrowth },
  ] as const;

  for (const entry of artificialFamilies) {
    for (let index = 0; index < entry.count; index += 1) {
      const length = random.pick(LENGTHS);
      examples.push({
        id: `artificial-${entry.family}-${String(index + 1).padStart(3, "0")}`,
        label: "artificial",
        family: entry.family,
        views: entry.generate(length, random),
      });
    }
  }

  const stressFamilies: { family: string; label: SyntheticLabel; generate: () => number[] }[] = [
    { family: "campanha_longa_autorizada", label: "legitimate", generate: () => generateStressBlock(random, "authorized") },
    // Same observable spike distribution, different known synthetic origin.
    { family: "pico_organico_curto", label: "legitimate", generate: () => generateIsolatedSpike(random.pick([24, 72, 168, 720]), random) },
    { family: "sazonalidade_diaria", label: "legitimate", generate: () => generateDailySeasonality(random) },
    { family: "bloco_longo", label: "artificial", generate: () => generateStressBlock(random, "long") },
    { family: "bloco_curto", label: "artificial", generate: () => generateStressBlock(random, "short") },
    { family: "bloco_ruidoso", label: "artificial", generate: () => generateStressBlock(random, "noisy") },
    { family: "bloco_sem_contexto", label: "artificial", generate: () => generateStressBlock(random, "boundary") },
    { family: "pulsos_fora_faixa", label: "artificial", generate: () => generateStressPulses(random, true) },
    { family: "pulsos_ruidosos", label: "artificial", generate: () => generateStressPulses(random, false) },
  ];
  for (const { family, label, generate } of stressFamilies) {
    for (let index = 0; index < 100; index += 1) {
      examples.push({ id: `${label}-${family}-${String(index + 1).padStart(3, "0")}`, label, family, views: generate() });
    }
  }

  const ambiguousBurst = Array.from({ length: 72 }, (_, hour) => {
    if (hour === 35) return 12_000;
    return 45 + (hour % 5) * 3;
  });

  return {
    schemaVersion: 1,
    seed,
    examples,
    ambiguityCases: [{
      id: "origem_ambigua_pico_isolado",
      possibleOrigins: ["viralizacao_organica", "compra_de_views"],
      expectedClassification: "inconclusivo",
      views: ambiguousBurst,
    }, {
      id: "origem_ambigua_pico_em_720_horas",
      possibleOrigins: ["viralizacao_organica", "compra_de_views"],
      expectedClassification: "inconclusivo",
      views: [...ambiguousBurst, ...Array<number>(648).fill(54)],
    }, {
      id: "bloco_longo_sem_termino_observado",
      possibleOrigins: ["campanha_autorizada", "compra_de_views"],
      expectedClassification: "inconclusivo",
      views: [...Array<number>(24).fill(20), ...Array<number>(30).fill(10_000)],
    }, {
      id: "bloco_com_variacao_limitrofe",
      possibleOrigins: ["campanha_autorizada", "compra_de_views"],
      expectedClassification: "inconclusivo",
      views: [...Array<number>(24).fill(20), ...Array.from({ length: 10 }, (_, index) => index % 2 === 0 ? 9_790 : 10_210), ...Array<number>(38).fill(20)],
    }],
  };
}
