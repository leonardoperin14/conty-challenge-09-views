import Fastify from "fastify";
import { classifyViews, MAX_HOURS, validateViewsInput } from "./classifier.js";

type ClassifyRequest = {
  Body: { views: number[] };
};

const classifyBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["views"],
  properties: {
    views: {
      type: "array",
      minItems: 1,
      maxItems: MAX_HOURS,
      items: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    },
  },
} as const;

export function buildApp() {
  const app = Fastify({
    bodyLimit: 256 * 1024,
    logger: false,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });

  app.get("/health", async () => ({ status: "ok" }));

  app.post<ClassifyRequest>("/classify", { schema: { body: classifyBodySchema } }, async (request, reply) => {
    const validationError = validateViewsInput(request.body.views);
    if (validationError !== undefined) {
      return reply.code(400).send({ error: { code: "INVALID_INPUT", message: validationError } });
    }
    return classifyViews(request.body.views);
  });

  app.setErrorHandler((error, _request, reply) => {
    if (
      typeof error === "object" &&
      error !== null &&
      "validation" in error &&
      Array.isArray(error.validation)
    ) {
      return reply.code(400).send({
        error: { code: "INVALID_INPUT", message: "Envie um objeto com uma lista válida de views." },
      });
    }

    const statusCode =
      typeof error === "object" && error !== null && "statusCode" in error ? error.statusCode : undefined;
    if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
      const clientError =
        statusCode === 413
          ? { code: "PAYLOAD_TOO_LARGE", message: "O corpo enviado excede o limite permitido." }
          : statusCode === 415
            ? { code: "UNSUPPORTED_MEDIA_TYPE", message: "Envie a requisição como JSON." }
            : { code: "INVALID_INPUT", message: "Envie um JSON válido com uma lista de views." };

      return reply.code(statusCode).send({ error: clientError });
    }

    app.log.error(error);
    return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "Não foi possível analisar a série." } });
  });

  return app;
}
