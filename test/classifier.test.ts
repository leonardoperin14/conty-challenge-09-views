import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { classifyViews, validateViewsInput } from "../src/classifier.js";

function organicViralization(): number[] {
  const length = 72;
  const center = 31;
  const width = 5;
  return Array.from({ length }, (_, hour) => {
    const distance = (hour - center) / width;
    return Math.round(100 + 1_800 * Math.exp(-0.5 * distance * distance));
  });
}

function mechanicalBlock(): number[] {
  return [
    ...Array(24).fill(20),
    20_000, 20_100, 20_000, 20_100, 20_000, 20_100, 20_000, 20_100, 20_000, 20_100,
    ...Array(38).fill(20),
  ];
}

function repeatedPulses(): number[] {
  const motif = [10, 10, 10, 1_000, 10, 10];
  return [...Array(12).fill(20), ...motif, ...motif, ...motif, ...motif, ...Array(24).fill(20)];
}

function plateau(duration: number, variation = 0): number[] {
  return [...Array<number>(24).fill(20), ...Array.from({ length: duration }, (_, index) =>
    Math.round(10_000 * (1 + (index % 2 === 0 ? -variation : variation)))), ...Array<number>(24).fill(20)];
}

describe("classifyViews", () => {
  it("keeps a plausible organic viral curve out of the suspicious category", () => {
    const result = classifyViews(organicViralization());
    assert.equal(result.classification, "sem_sinais_suspeitos");
    assert.match(result.reason, /nenhuma janela satisfez/);
    assert.equal(result.recommendedAction, "nenhuma");
  });

  it("flags a flat, elevated block with abrupt edges and explains the measured signals", () => {
    const result = classifyViews(mechanicalBlock());
    assert.equal(result.classification, "suspeito");
    assert.equal(result.recommendedAction, "revisao_humana");
    assert.match(result.reason, /horas 25 e 34/);
    assert.ok(result.signals.some((signal) => signal.code === "plateau.coefficient_of_variation" && signal.triggered));
    assert.ok(result.signals.some((signal) => signal.code === "plateau.rise_ratio" && signal.triggered));
  });

  it("flags four almost identical high contrast pulses", () => {
    const result = classifyViews(repeatedPulses());
    assert.equal(result.classification, "suspeito");
    assert.equal(result.recommendedAction, "revisao_humana");
    assert.ok(result.signals.some((signal) => signal.code === "repetition.cycles"));
  });

  it("distinguishes a smooth organic peak from a mechanical block at similar reach and peak height", () => {
    const bought = [...Array<number>(24).fill(20), ...Array<number>(10).fill(20_000), ...Array<number>(38).fill(20)];
    const organic = Array.from({ length: 72 }, (_, hour) => Math.round(20 + 19_980 * Math.exp(-0.5 * ((hour - 29) / 4) ** 2)));
    const total = (views: number[]) => views.reduce((sum, value) => sum + value, 0);
    assert.ok(Math.abs(total(organic) / total(bought) - 1) < 0.02);
    assert.equal(Math.max(...organic), Math.max(...bought));
    assert.equal(classifyViews(organic).classification, "sem_sinais_suspeitos");
    assert.equal(classifyViews(bought).classification, "suspeito");
  });

  it("does not lose a mechanical block when its duration exceeds 24 hours", () => {
    for (const duration of [8, 24, 25, 48, 168, 672]) {
      const views = plateau(duration);
      assert.equal(validateViewsInput(views), undefined);
      const result = classifyViews(views);
      assert.equal(result.classification, "suspeito", `duration=${duration}`);
      assert.equal(result.signals.find((signal) => signal.code === "plateau.duration_hours")?.value, duration);
      assert.match(result.reason, new RegExp(`horas 25 e ${24 + duration}`));
    }
  });

  it("abstains on short elevated blocks instead of silently dismissing them", () => {
    for (const duration of [4, 7]) {
      const result = classifyViews(plateau(duration));
      assert.equal(result.classification, "inconclusivo");
      assert.match(result.reason, /menos que o mínimo de 8/);
      assert.equal(result.signals.find((signal) => signal.code === "plateau.duration_hours")?.triggered, false);
    }
  });

  it("uses a conservative abstention band just beyond the strict variation limit", () => {
    assert.equal(classifyViews(plateau(10, 0.02)).classification, "suspeito");
    for (const variation of [0.021, 0.03, 0.05]) {
      const result = classifyViews(plateau(10, variation));
      assert.equal(result.classification, "inconclusivo", `variation=${variation}`);
      assert.match(result.reason, /variação.*acima do limite de 2%/);
      assert.equal(result.signals.find((signal) => signal.code === "plateau.coefficient_of_variation")?.triggered, false);
    }
  });

  it("explains a rejected elevated candidate with its failing measured signal", () => {
    const result = classifyViews(plateau(10, 0.06));
    assert.equal(result.classification, "sem_sinais_suspeitos");
    assert.match(result.reason, /bloco elevado.*variação de 6%/);
    assert.match(result.reason, /supera os limites/);
    assert.equal(result.signals.find((signal) => signal.code === "plateau.coefficient_of_variation")?.triggered, false);
  });

  it("reports the measured shape error when a repeated candidate is too irregular", () => {
    const views = [...Array<number>(24).fill(200), 1_000, 10, 1_100, 10, 900, 10, 1_000, 10, ...Array<number>(24).fill(200)];
    const result = classifyViews(views);
    assert.equal(result.classification, "sem_sinais_suspeitos");
    assert.match(result.reason, /sequência repetida.*acima do limite de 2%/);
    const signal = result.signals.find((item) => item.code === "repetition.normalized_error");
    assert.ok(signal);
    assert.equal(signal.triggered, false);
    assert.ok(signal.value > 0.02);
  });

  it("requires observed context on both sides of a long elevated block", () => {
    const complete = plateau(30);
    const truncated = [complete.slice(24), complete.slice(0, -24), complete.slice(0, -21)];
    for (const views of truncated) {
      const result = classifyViews(views);
      assert.equal(result.classification, "inconclusivo");
      assert.match(result.reason, /contexto/);
      assert.ok(result.signals.some((signal) => signal.code.startsWith("plateau.context_") && !signal.triggered));
    }
    assert.equal(classifyViews(complete).classification, "suspeito");
  });

  it("preserves local spike abstention when normal hours are appended or prepended", () => {
    const views = [...Array<number>(35).fill(50), 12_000, ...Array<number>(36).fill(50)];
    const original = classifyViews(views);
    assert.equal(original.classification, "inconclusivo");
    for (const extended of [[...views, ...Array<number>(648).fill(50)], [...Array<number>(648).fill(50), ...views]]) {
      const result = classifyViews(extended);
      assert.equal(result.classification, original.classification);
      for (const code of ["peak.top_three_share", "peak_to_median.ratio"]) {
        assert.equal(result.signals.find((signal) => signal.code === code)?.value, original.signals.find((signal) => signal.code === code)?.value);
      }
      const window = result.signals.find((signal) => signal.code === "peak.top_three_share")?.window;
      assert.ok(window);
      assert.equal(window.endHour - window.startHour + 1, 24);
    }
  });

  it("abstains on an isolated spike whose origin cannot be inferred", () => {
    const views = [...Array(35).fill(50), 12_000, ...Array(36).fill(55)];
    const result = classifyViews(views);
    assert.equal(result.classification, "inconclusivo");
    assert.equal(result.recommendedAction, "revisao_humana");
    assert.match(result.reason, /viralização real/);
  });

  it("returns the same abstention for identical observations with different possible origins", () => {
    const views = [...Array(35).fill(54), 12_000, ...Array(36).fill(57)];
    const organicOrigin = classifyViews(views);
    const purchasedOrigin = classifyViews(views);
    assert.deepEqual(organicOrigin, purchasedOrigin);
    assert.equal(organicOrigin.classification, "inconclusivo");
  });

  it("abstains when there are fewer than 24 hourly observations", () => {
    assert.equal(classifyViews(Array(23).fill(0)).classification, "inconclusivo");
  });

  it("does not flag a sufficiently long all-zero series", () => {
    assert.equal(classifyViews(Array(48).fill(0)).classification, "sem_sinais_suspeitos");
  });
});

describe("POST /classify", () => {
  it("returns the classifier result for a valid series", async (context) => {
    const app = buildApp();
    context.after(() => app.close());
    const response = await app.inject({ method: "POST", url: "/classify", payload: { views: organicViralization() } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().classification, "sem_sinais_suspeitos");
  });

  it("exposes the new decisions and window signals through HTTP, including 720 hours", async (context) => {
    const app = buildApp();
    context.after(() => app.close());
    const cases = [
      { views: plateau(672), expected: "suspeito", signalCode: "plateau.duration_hours" },
      { views: plateau(10, 0.021), expected: "inconclusivo", signalCode: "plateau.coefficient_of_variation" },
      { views: [...Array<number>(35).fill(50), 12_000, ...Array<number>(684).fill(50)], expected: "inconclusivo", signalCode: "peak.top_three_share" },
    ];
    for (const { views, expected, signalCode } of cases) {
      const response = await app.inject({ method: "POST", url: "/classify", payload: { views } });
      assert.equal(response.statusCode, 200);
      const body = response.json();
      assert.equal(body.classification, expected);
      assert.deepEqual(body, classifyViews(views));
      assert.ok(body.signals.some((signal: { code: string; window?: unknown }) => signal.code === signalCode && signal.window !== undefined));
    }
  });

  it("rejects invalid values, unknown properties and an unsafe sum", async (context) => {
    const app = buildApp();
    context.after(() => app.close());
    const invalidPayloads = [
      { views: [] },
      { views: [1, -1] },
      { views: [1.5] },
      { views: ["4"] },
      { views: [1], extra: true },
      { views: [Number.MAX_SAFE_INTEGER, 1] },
    ];

    for (const payload of invalidPayloads) {
      const response = await app.inject({ method: "POST", url: "/classify", payload });
      assert.equal(response.statusCode, 400, JSON.stringify(payload));
      assert.equal(response.json().error.code, "INVALID_INPUT");
    }
  });

  it("returns a clear 400 response for malformed JSON", async (context) => {
    const app = buildApp();
    context.after(() => app.close());
    const response = await app.inject({
      method: "POST",
      url: "/classify",
      headers: { "content-type": "application/json" },
      payload: '{"views":[',
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), {
      error: { code: "INVALID_INPUT", message: "Envie um JSON válido com uma lista de views." },
    });
  });

  it("preserves 413 for a body that exceeds the configured limit", async (context) => {
    const app = buildApp();
    context.after(() => app.close());
    const response = await app.inject({
      method: "POST",
      url: "/classify",
      headers: { "content-type": "application/json" },
      payload: "x".repeat(256 * 1024 + 1),
    });

    assert.equal(response.statusCode, 413);
    assert.deepEqual(response.json(), {
      error: { code: "PAYLOAD_TOO_LARGE", message: "O corpo enviado excede o limite permitido." },
    });
  });

  it("preserves 415 for an unsupported content type", async (context) => {
    const app = buildApp();
    context.after(() => app.close());
    const response = await app.inject({
      method: "POST",
      url: "/classify",
      headers: { "content-type": "application/x-unsupported" },
      payload: "body",
    });

    assert.equal(response.statusCode, 415);
    assert.deepEqual(response.json(), {
      error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Envie a requisição como JSON." },
    });
  });

  it("keeps unexpected failures as generic HTTP 500 responses", async (context) => {
    const app = buildApp();
    context.after(() => app.close());
    app.get("/test/internal-error", async () => {
      throw new Error("private internal details");
    });

    const response = await app.inject({ method: "GET", url: "/test/internal-error" });
    assert.equal(response.statusCode, 500);
    assert.equal(response.json().error.code, "INTERNAL_ERROR");
    assert.equal(response.body.includes("private internal details"), false);
  });
});
