import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { classifyViews } from "../src/classifier.js";

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

describe("classifyViews", () => {
  it("keeps a plausible organic viral curve out of the suspicious category", () => {
    const result = classifyViews(organicViralization());
    assert.equal(result.classification, "sem_sinais_suspeitos");
    assert.match(result.reason, /não apareceram/);
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

  it("abstains on an isolated spike whose origin cannot be inferred", () => {
    const views = [...Array(35).fill(50), 12_000, ...Array(36).fill(55)];
    const result = classifyViews(views);
    assert.equal(result.classification, "inconclusivo");
    assert.equal(result.recommendedAction, "obter_mais_dados");
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
