export const RULE_VERSION = "1.1.0";
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
  beforeCount: number;
  afterCount: number;
};

type RepeatedPattern = {
  start: number;
  period: number;
  normalizedError: number;
  amplitude: number;
  contrast: number;
};

const PLATEAU_MIN_HOURS = 8;
const PLATEAU_MAX_CV = 0.02;
const PLATEAU_ABSTENTION_MAX_CV = 0.05;
const PLATEAU_DIAGNOSTIC_MAX_CV = 0.15;
const PLATEAU_DIAGNOSTIC_MIN_HOURS = 4;
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
const PEAK_WINDOW_HOURS = 24;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const lower = sorted[middle - 1];
  const upper = sorted[middle];
  if (upper === undefined) return 0;
  if (sorted.length % 2 === 1 || lower === undefined) return upper;
  return (lower + upper) / 2;
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
  nearMiss: Plateau | undefined;
} {
  let confirmed: Plateau | undefined;
  let boundary: Plateau | undefined;
  let nearMiss: Plateau | undefined;

  // Candidate starts/ends are abrupt edges or collection boundaries. Analyze the
  // whole episode, including long blocks, rather than chopping it into 24h slices.
  // Welford's running variance avoids cancellation for large safe-integer counts.
  for (let start = 0; start + PLATEAU_DIAGNOSTIC_MIN_HOURS <= views.length; start += 1) {
    const riseRatio = start > 0 ? views[start]! / Math.max(1, views[start - 1]!) : 0;
    if (start >= CONTEXT_HOURS && riseRatio < PLATEAU_MIN_EDGE_RATIO) continue;
    const beforeCount = Math.min(CONTEXT_HOURS, start);
    const beforeMedian = median(views.slice(start - beforeCount, start));
    let mean = 0;
    let squaredDeviations = 0;

    for (let end = start; end < views.length; end += 1) {
      const duration = end - start + 1;
      const delta = views[end]! - mean;
      mean += delta / duration;
      squaredDeviations += delta * (views[end]! - mean);
      if (duration < PLATEAU_DIAGNOSTIC_MIN_HOURS || mean < PLATEAU_MIN_MEAN) continue;
      const afterCount = Math.min(CONTEXT_HOURS, views.length - end - 1);
      const dropRatio = end + 1 < views.length
        ? views[end]! / Math.max(1, views[end + 1]!)
        : 0;
      if (afterCount >= CONTEXT_HOURS && dropRatio < PLATEAU_MIN_EDGE_RATIO) continue;
      const cv = Math.sqrt(Math.max(0, squaredDeviations / duration)) / mean;
      if (cv > PLATEAU_DIAGNOSTIC_MAX_CV) continue;
      const afterMedian = median(views.slice(end + 1, end + 1 + afterCount));
      const lift = mean / Math.max(1, beforeMedian, afterMedian);
      if (lift < PLATEAU_MIN_LIFT) continue;
      const enoughContext = beforeCount >= CONTEXT_HOURS && afterCount >= CONTEXT_HOURS;
      const bothEdges = riseRatio >= PLATEAU_MIN_EDGE_RATIO && dropRatio >= PLATEAU_MIN_EDGE_RATIO;
      const plateau: Plateau = {
        start, end, mean, coefficientOfVariation: cv, lift, riseRatio, dropRatio, beforeCount, afterCount,
      };
      if (enoughContext && bothEdges) {
        if (duration >= PLATEAU_MIN_HOURS && cv <= PLATEAU_MAX_CV) {
          confirmed ??= plateau;
        } else if (nearMiss === undefined || cv < nearMiss.coefficientOfVariation) {
          nearMiss = plateau;
        }
      } else if (
        !enoughContext &&
        cv <= PLATEAU_ABSTENTION_MAX_CV &&
        (riseRatio >= PLATEAU_MIN_EDGE_RATIO || dropRatio >= PLATEAU_MIN_EDGE_RATIO)
      ) {
        boundary ??= plateau;
      }
    }
  }

  return { confirmed, boundary, nearMiss };
}

function findRepeatedPattern(views: readonly number[]): {
  confirmed: RepeatedPattern | undefined;
  nearMiss: RepeatedPattern | undefined;
} {
  let nearMiss: RepeatedPattern | undefined;
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
      const pattern = { start, period, normalizedError, amplitude, contrast };
      if (normalizedError <= REPEAT_MAX_NORMALIZED_ERROR) {
        return { confirmed: pattern, nearMiss };
      }
      if (normalizedError <= 0.1 && (nearMiss === undefined || normalizedError < nearMiss.normalizedError)) {
        nearMiss = pattern;
      }
    }
  }
  return { confirmed: undefined, nearMiss };
}

type PeakWindow = { start: number; end: number; peakHour: number; share: number; ratio: number };

function findPeakWindow(views: readonly number[]): PeakWindow {
  let best: PeakWindow | undefined;
  // Center on an observed local maximum. Arbitrary sliding windows can mistake
  // a smooth organic curve's rising shoulder for an isolated spike.
  for (let hour = 0; hour < views.length; hour += 1) {
    if ((hour > 0 && views[hour]! < views[hour - 1]!) ||
      (hour + 1 < views.length && views[hour]! < views[hour + 1]!)) continue;
    const start = Math.max(0, Math.min(hour - PEAK_WINDOW_HOURS / 2, views.length - PEAK_WINDOW_HOURS));
    const section = views.slice(start, start + PEAK_WINDOW_HOURS);
    const sorted = [...section].sort((a, b) => b - a);
    const total = section.reduce((sum, count) => sum + count, 0);
    const largest = sorted[0]!;
    if (views[hour] !== largest) continue;
    const share = total === 0 ? 0 : (sorted[0]! + sorted[1]! + sorted[2]!) / total;
    const localMedian = (sorted[PEAK_WINDOW_HOURS / 2 - 1]! + sorted[PEAK_WINDOW_HOURS / 2]!) / 2;
    const ratio = largest / Math.max(1, localMedian);
    const candidate = { start, end: start + PEAK_WINDOW_HOURS - 1, peakHour: hour, share, ratio };
    const qualifies = share >= PEAK_SHARE_THRESHOLD && ratio >= PEAK_MEDIAN_RATIO_THRESHOLD;
    const bestQualifies = best !== undefined && best.share >= PEAK_SHARE_THRESHOLD && best.ratio >= PEAK_MEDIAN_RATIO_THRESHOLD;
    if (best === undefined || (qualifies && !bestQualifies) || (qualifies === bestQualifies && share > best.share)) {
      best = candidate;
    }
  }
  return best!; // Only called after the 24-hour minimum check.
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
    windowSignal("plateau.duration_hours", plateau.end - plateau.start + 1, "hours", PLATEAU_MIN_HOURS, ">=", plateau.end - plateau.start + 1 >= PLATEAU_MIN_HOURS, plateau.start, plateau.end),
    windowSignal("plateau.mean_views_per_hour", plateau.mean, "views/h", PLATEAU_MIN_MEAN, ">=", plateau.mean >= PLATEAU_MIN_MEAN, plateau.start, plateau.end),
    windowSignal("plateau.coefficient_of_variation", plateau.coefficientOfVariation, "ratio", PLATEAU_MAX_CV, "<=", plateau.coefficientOfVariation <= PLATEAU_MAX_CV, plateau.start, plateau.end),
    windowSignal("plateau.lift_over_background", plateau.lift, "ratio", PLATEAU_MIN_LIFT, ">=", plateau.lift >= PLATEAU_MIN_LIFT, plateau.start, plateau.end),
    windowSignal("plateau.rise_ratio", plateau.riseRatio, "ratio", PLATEAU_MIN_EDGE_RATIO, ">=", plateau.riseRatio >= PLATEAU_MIN_EDGE_RATIO, plateau.start, plateau.end),
    windowSignal("plateau.drop_ratio", plateau.dropRatio, "ratio", PLATEAU_MIN_EDGE_RATIO, ">=", plateau.dropRatio >= PLATEAU_MIN_EDGE_RATIO, plateau.start, plateau.end),
    windowSignal("plateau.context_before_hours", plateau.beforeCount, "hours", CONTEXT_HOURS, ">=", plateau.beforeCount >= CONTEXT_HOURS, plateau.start, plateau.end),
    windowSignal("plateau.context_after_hours", plateau.afterCount, "hours", CONTEXT_HOURS, ">=", plateau.afterCount >= CONTEXT_HOURS, plateau.start, plateau.end),
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

  const repetition = findRepeatedPattern(views);
  const repeated = repetition.confirmed;
  if (repeated !== undefined) {
    const end = repeated.start + repeated.period * REPEAT_CYCLES - 1;
    return result(
      "suspeito",
      `Entre as horas ${repeated.start + 1} e ${end + 1}, a mesma sequência de altas e baixas se repetiu ${REPEAT_CYCLES} vezes, a cada ${repeated.period} horas. A diferença entre ciclos foi de ${formatNumber(repeated.normalizedError * 100)}% da amplitude, abaixo do limite de 2%, com nível alto ${formatNumber(repeated.contrast)} vezes o baixo. Recomendo revisão humana.`,
      repeatedSignals(repeated),
      "revisao_humana",
    );
  }

  const total = views.reduce((sum, count) => sum + count, 0);
  const peak = findPeakWindow(views);
  const concentrationSignals: Signal[] = [
    windowSignal("peak.top_three_share", peak.share, "ratio", PEAK_SHARE_THRESHOLD, ">=", peak.share >= PEAK_SHARE_THRESHOLD, peak.start, peak.end),
    windowSignal("peak_to_median.ratio", peak.ratio, "ratio", PEAK_MEDIAN_RATIO_THRESHOLD, ">=", peak.ratio >= PEAK_MEDIAN_RATIO_THRESHOLD, peak.start, peak.end),
  ];

  if (plateau.boundary !== undefined) {
    const { start, end } = plateau.boundary;
    return result(
      "inconclusivo",
      `Há um bloco elevado e regular entre as horas ${start + 1} e ${end + 1}, mas não há pelo menos quatro horas de contexto em uma das bordas para avaliar como ele começou ou terminou. Obtenha o trecho anterior ou posterior que está faltando.`,
      [...plateauSignals(plateau.boundary), ...concentrationSignals],
      "obter_mais_dados",
    );
  }

  const nearMiss = plateau.nearMiss;
  if (nearMiss !== undefined && nearMiss.coefficientOfVariation <= PLATEAU_ABSTENTION_MAX_CV) {
    const duration = nearMiss.end - nearMiss.start + 1;
    const limitations = [
      ...(duration < PLATEAU_MIN_HOURS ? [`durou ${duration} horas, menos que o mínimo de ${PLATEAU_MIN_HOURS}`] : []),
      ...(nearMiss.coefficientOfVariation > PLATEAU_MAX_CV ? [`a variação foi ${formatNumber(nearMiss.coefficientOfVariation * 100)}%, acima do limite de 2% para sinalizar`] : []),
    ];
    return result(
      "inconclusivo",
      `Há um bloco elevado com início e fim abruptos entre as horas ${nearMiss.start + 1} e ${nearMiss.end + 1}, mas ${limitations.join(" e ")}. É um caso próximo dos critérios; prefiro não acusar. Verifique o contexto da divulgação e a origem do tráfego.`,
      [...plateauSignals(nearMiss), ...concentrationSignals],
      "revisao_humana",
    );
  }

  if (peak.share >= PEAK_SHARE_THRESHOLD && peak.ratio >= PEAK_MEDIAN_RATIO_THRESHOLD) {
    return result(
      "inconclusivo",
      `Entre as horas ${peak.start + 1} e ${peak.end + 1}, as três maiores horas somam ${formatNumber(peak.share * 100)}% das views desse intervalo. O pico da hora ${peak.peakHour + 1} é ${formatNumber(peak.ratio)} vezes a mediana local. Um pico isolado pode ser uma viralização real; verifique a origem do tráfego antes de concluir.`,
      [...concentrationSignals, { code: "peak.hour", value: peak.peakHour + 1, unit: "hour", triggered: true }],
      "revisao_humana",
    );
  }

  const range = views.length;
  let reason = total === 0
    ? `A série de ${range} horas contém somente valores zero; os padrões de pico ou repetição avaliados não aparecem.`
    : `Em ${range} horas, nenhuma janela satisfez os critérios documentados de bloco mecânico, repetição ou pico concentrado. Isso não comprova a origem das views.`;
  const diagnostics = [...concentrationSignals];
  if (nearMiss !== undefined) {
    reason += ` Há um bloco elevado entre as horas ${nearMiss.start + 1} e ${nearMiss.end + 1}, mas sua variação de ${formatNumber(nearMiss.coefficientOfVariation * 100)}% supera os limites de suspeita (2%) e abstenção (5%).`;
    diagnostics.push(...plateauSignals(nearMiss));
  }
  if (repetition.nearMiss !== undefined) {
    reason += ` A sequência repetida mais próxima dos critérios teve diferença entre ciclos de ${formatNumber(repetition.nearMiss.normalizedError * 100)}% da amplitude, acima do limite de 2%.`;
    diagnostics.push(...repeatedSignals(repetition.nearMiss));
  }
  return result("sem_sinais_suspeitos", reason, diagnostics, "nenhuma");
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
