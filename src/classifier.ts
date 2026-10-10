export const RULE_VERSION = "1.0.0";
export const MIN_HOURS_FOR_CLASSIFICATION = 24;
export const MAX_HOURS = 720;

export type Classification =
  | "sem_sinais_suspeitos"
  | "inconclusivo"
  | "suspeito";

export type Signal = {
  code: string;
  value: number;
  unit: string;
  threshold?: number;
  comparison?: "<=" | ">=";
  triggered: boolean;
  window?: { startHour: number; endHour: number };
};

export type ClassificationResult = {
  classification: Classification;
  reason: string;
  signals: Signal[];
  recommendedAction: "nenhuma" | "obter_mais_dados" | "revisao_humana";
  ruleVersion: string;
};

type Plateau = {
  start: number;
  end: number;
  mean: number;
  coefficientOfVariation: number;
  lift: number;
  riseRatio: number;
  dropRatio: number;
};

type RepeatedPattern = {
  start: number;
  period: number;
  normalizedError: number;
  amplitude: number;
  contrast: number;
};

const PLATEAU_MIN_HOURS = 8;
const PLATEAU_MAX_HOURS = 24;
const PLATEAU_MAX_CV = 0.02;
const PLATEAU_MIN_MEAN = 100;
const PLATEAU_MIN_LIFT = 10;
const PLATEAU_MIN_EDGE_RATIO = 5;
const CONTEXT_HOURS = 4;
const REPEAT_MIN_PERIOD = 2;
const REPEAT_MAX_PERIOD = 12;
const REPEAT_CYCLES = 4;
const REPEAT_MAX_NORMALIZED_ERROR = 0.02;
const REPEAT_MIN_AMPLITUDE = 100;
const REPEAT_MIN_CONTRAST = 10;
const PEAK_SHARE_THRESHOLD = 0.6;
const PEAK_MEDIAN_RATIO_THRESHOLD = 10;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const lower = sorted[middle - 1];
  const upper = sorted[middle];
  if (upper === undefined) return 0;
  if (sorted.length % 2 === 1 || lower === undefined) return upper;
  return (lower + upper) / 2;
}

function coefficientOfVariation(values: readonly number[]): number {
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  if (mean === 0) return 0;
  const meanSquare = values.reduce((total, value) => total + value * value, 0) / values.length;
  const variance = Math.max(0, meanSquare - mean * mean);
  return Math.sqrt(variance) / mean;
}

function windowSignal(
  code: string,
  value: number,
  unit: string,
  threshold: number,
  comparison: "<=" | ">=",
  triggered: boolean,
  start: number,
  end: number,
): Signal {
  return {
    code,
    value,
    unit,
    threshold,
    comparison,
    triggered,
    window: { startHour: start + 1, endHour: end + 1 },
  };
}

function findPlateaus(views: readonly number[]): {
  confirmed: Plateau | undefined;
  boundary: Plateau | undefined;
} {
  let confirmed: Plateau | undefined;
  let boundary: Plateau | undefined;

  for (let duration = PLATEAU_MIN_HOURS; duration <= PLATEAU_MAX_HOURS; duration += 1) {
    for (let start = 0; start + duration <= views.length; start += 1) {
      const end = start + duration - 1;
      const section = views.slice(start, end + 1);
      const mean = section.reduce((total, value) => total + value, 0) / duration;
      if (mean < PLATEAU_MIN_MEAN) continue;

      const cv = coefficientOfVariation(section);
      if (cv > PLATEAU_MAX_CV) continue;

      const beforeCount = Math.min(CONTEXT_HOURS, start);
      const afterCount = Math.min(CONTEXT_HOURS, views.length - end - 1);
      const before = beforeCount > 0 ? views.slice(start - beforeCount, start) : [];
      const after = afterCount > 0 ? views.slice(end + 1, end + 1 + afterCount) : [];
      const beforeMedian = median(before);
      const afterMedian = median(after);
      const availableReferences = [beforeMedian, afterMedian].filter((value) => value > 0);
      const baseline = Math.max(1, ...availableReferences);
      const lift = mean / baseline;
      const riseRatio = start > 0 ? views[start]! / Math.max(1, views[start - 1]!) : 0;
      const dropRatio = end + 1 < views.length
        ? views[end]! / Math.max(1, views[end + 1]!)
        : 0;

      const enoughContext = beforeCount >= CONTEXT_HOURS && afterCount >= CONTEXT_HOURS;
      const plateau: Plateau = { start, end, mean, coefficientOfVariation: cv, lift, riseRatio, dropRatio };
      if (
        enoughContext &&
        lift >= PLATEAU_MIN_LIFT &&
        riseRatio >= PLATEAU_MIN_EDGE_RATIO &&
        dropRatio >= PLATEAU_MIN_EDGE_RATIO
      ) {
        if (confirmed === undefined || start < confirmed.start || (start === confirmed.start && duration < confirmed.end - confirmed.start + 1)) {
          confirmed = plateau;
        }
      } else if (
        !enoughContext &&
        lift >= PLATEAU_MIN_LIFT &&
        ((start > 0 && riseRatio >= PLATEAU_MIN_EDGE_RATIO) ||
          (end + 1 < views.length && dropRatio >= PLATEAU_MIN_EDGE_RATIO))
      ) {
        if (boundary === undefined || start < boundary.start || (start === boundary.start && duration < boundary.end - boundary.start + 1)) {
          boundary = plateau;
        }
      }
    }
  }

  return { confirmed, boundary };
}

function findRepeatedPattern(views: readonly number[]): RepeatedPattern | undefined {
  for (let period = REPEAT_MIN_PERIOD; period <= REPEAT_MAX_PERIOD; period += 1) {
    const duration = period * REPEAT_CYCLES;
    for (let start = 0; start + duration <= views.length; start += 1) {
      const template = Array.from({ length: period }, (_, phase) => {
        let total = 0;
        for (let cycle = 0; cycle < REPEAT_CYCLES; cycle += 1) {
          total += views[start + cycle * period + phase]!;
        }
        return total / REPEAT_CYCLES;
      });

      const minimum = Math.min(...template);
      const maximum = Math.max(...template);
      const amplitude = maximum - minimum;
      const contrast = (maximum + 1) / (minimum + 1);
      if (amplitude < REPEAT_MIN_AMPLITUDE || contrast < REPEAT_MIN_CONTRAST) continue;

      let squaredError = 0;
      for (let cycle = 0; cycle < REPEAT_CYCLES; cycle += 1) {
        for (let phase = 0; phase < period; phase += 1) {
          const difference = views[start + cycle * period + phase]! - template[phase]!;
          squaredError += difference * difference;
        }
      }
      const normalizedError = Math.sqrt(squaredError / duration) / amplitude;
      if (normalizedError <= REPEAT_MAX_NORMALIZED_ERROR) {
        return { start, period, normalizedError, amplitude, contrast };
      }
    }
  }
  return undefined;
}

function formatNumber(value: number, maximumFractionDigits = 2): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits }).format(value);
}

function result(
  classification: Classification,
  reason: string,
  signals: Signal[],
  recommendedAction: ClassificationResult["recommendedAction"],
): ClassificationResult {
  return { classification, reason, signals, recommendedAction, ruleVersion: RULE_VERSION };
}

function plateauSignals(plateau: Plateau): Signal[] {
  return [
    windowSignal("plateau.mean_views_per_hour", plateau.mean, "views/h", PLATEAU_MIN_MEAN, ">=", plateau.mean >= PLATEAU_MIN_MEAN, plateau.start, plateau.end),
    windowSignal("plateau.coefficient_of_variation", plateau.coefficientOfVariation, "ratio", PLATEAU_MAX_CV, "<=", plateau.coefficientOfVariation <= PLATEAU_MAX_CV, plateau.start, plateau.end),
    windowSignal("plateau.lift_over_background", plateau.lift, "ratio", PLATEAU_MIN_LIFT, ">=", plateau.lift >= PLATEAU_MIN_LIFT, plateau.start, plateau.end),
    windowSignal("plateau.rise_ratio", plateau.riseRatio, "ratio", PLATEAU_MIN_EDGE_RATIO, ">=", plateau.riseRatio >= PLATEAU_MIN_EDGE_RATIO, plateau.start, plateau.end),
    windowSignal("plateau.drop_ratio", plateau.dropRatio, "ratio", PLATEAU_MIN_EDGE_RATIO, ">=", plateau.dropRatio >= PLATEAU_MIN_EDGE_RATIO, plateau.start, plateau.end),
  ];
}

function repeatedSignals(pattern: RepeatedPattern): Signal[] {
  const end = pattern.start + pattern.period * REPEAT_CYCLES - 1;
  return [
    windowSignal("repetition.period_hours", pattern.period, "hours", REPEAT_MAX_PERIOD, "<=", true, pattern.start, end),
    windowSignal("repetition.cycles", REPEAT_CYCLES, "cycles", REPEAT_CYCLES, ">=", true, pattern.start, end),
    windowSignal("repetition.normalized_error", pattern.normalizedError, "ratio", REPEAT_MAX_NORMALIZED_ERROR, "<=", pattern.normalizedError <= REPEAT_MAX_NORMALIZED_ERROR, pattern.start, end),
    windowSignal("repetition.amplitude", pattern.amplitude, "views/h", REPEAT_MIN_AMPLITUDE, ">=", pattern.amplitude >= REPEAT_MIN_AMPLITUDE, pattern.start, end),
    windowSignal("repetition.contrast", pattern.contrast, "ratio", REPEAT_MIN_CONTRAST, ">=", pattern.contrast >= REPEAT_MIN_CONTRAST, pattern.start, end),
  ];
}

export function classifyViews(views: readonly number[]): ClassificationResult {
  if (views.length < MIN_HOURS_FOR_CLASSIFICATION) {
    return result(
      "inconclusivo",
      `A série tem ${views.length} horas; são necessárias pelo menos ${MIN_HOURS_FOR_CLASSIFICATION} para avaliar os padrões temporais.`,
      [{ code: "series.hours", value: views.length, unit: "hours", threshold: MIN_HOURS_FOR_CLASSIFICATION, comparison: ">=", triggered: false }],
      "obter_mais_dados",
    );
  }

  const plateau = findPlateaus(views);
  if (plateau.confirmed !== undefined) {
    const { start, end, mean, coefficientOfVariation: cv, lift } = plateau.confirmed;
    return result(
      "suspeito",
      `Entre as horas ${start + 1} e ${end + 1}, as views ficaram quase constantes (${formatNumber(cv * 100)}% de variação), em média ${formatNumber(mean)} por hora, e superaram o fundo local em ${formatNumber(lift)} vezes. O início e o fim também foram abruptos; recomendo revisão humana.`,
      plateauSignals(plateau.confirmed),
      "revisao_humana",
    );
  }

  const repeated = findRepeatedPattern(views);
  if (repeated !== undefined) {
    const end = repeated.start + repeated.period * REPEAT_CYCLES - 1;
    return result(
      "suspeito",
      `Entre as horas ${repeated.start + 1} e ${end + 1}, um padrão de ${repeated.period} horas se repetiu ${REPEAT_CYCLES} vezes com erro de forma de ${formatNumber(repeated.normalizedError * 100)}% e contraste de ${formatNumber(repeated.contrast)} vezes. Recomendo revisão humana.`,
      repeatedSignals(repeated),
      "revisao_humana",
    );
  }

  const total = views.reduce((sum, count) => sum + count, 0);
  const largestHour = Math.max(...views);
  const sortedDescending = [...views].sort((a, b) => b - a);
  const topThreeShare = total === 0 ? 0 : sortedDescending.slice(0, 3).reduce((sum, count) => sum + count, 0) / total;
  const peakMedianRatio = largestHour / Math.max(1, median(views));
  const concentrationSignals: Signal[] = [
    { code: "peak.top_three_share", value: topThreeShare, unit: "ratio", threshold: PEAK_SHARE_THRESHOLD, comparison: ">=", triggered: topThreeShare >= PEAK_SHARE_THRESHOLD },
    { code: "peak_to_median.ratio", value: peakMedianRatio, unit: "ratio", threshold: PEAK_MEDIAN_RATIO_THRESHOLD, comparison: ">=", triggered: peakMedianRatio >= PEAK_MEDIAN_RATIO_THRESHOLD },
  ];

  if (plateau.boundary !== undefined) {
    const { start, end } = plateau.boundary;
    return result(
      "inconclusivo",
      `Há um bloco quase constante e elevado entre as horas ${start + 1} e ${end + 1}, mas falta contexto em uma das bordas para confirmar como ele começou ou terminou. São necessários mais dados.`,
      [...plateauSignals(plateau.boundary), ...concentrationSignals],
      "obter_mais_dados",
    );
  }

  if (topThreeShare >= PEAK_SHARE_THRESHOLD && peakMedianRatio >= PEAK_MEDIAN_RATIO_THRESHOLD) {
    const peakHour = views.indexOf(largestHour) + 1;
    return result(
      "inconclusivo",
      `O pico da hora ${peakHour} concentra ${formatNumber(topThreeShare * 100)}% das views nas três maiores horas e é ${formatNumber(peakMedianRatio)} vezes a mediana. Um pico isolado pode ser uma viralização real; os dados não permitem concluir a origem.`,
      [...concentrationSignals, { code: "peak.hour", value: peakHour, unit: "hour", triggered: true }],
      "obter_mais_dados",
    );
  }

  const range = views.length;
  const reason = total === 0
    ? `A série de ${range} horas contém somente valores zero; os padrões de pico ou repetição avaliados não aparecem.`
    : `Em ${range} horas, não apareceram blocos elevados quase constantes, quatro ciclos mecânicos repetidos ou um pico concentrado que exija abstenção. Isso não comprova a origem das views.`;
  return result("sem_sinais_suspeitos", reason, concentrationSignals, "nenhuma");
}

export function validateViewsInput(views: unknown): string | undefined {
  if (!Array.isArray(views) || views.length < 1 || views.length > MAX_HOURS) {
    return `views deve ser uma lista com entre 1 e ${MAX_HOURS} valores.`;
  }

  let total = 0;
  for (const value of views) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
      return "Cada valor de views deve ser um inteiro seguro não negativo.";
    }
    total += value;
    if (!Number.isSafeInteger(total)) {
      return "A soma das views excede o limite de inteiros seguros.";
    }
  }
  return undefined;
}
