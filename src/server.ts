import { pathToFileURL } from "node:url";
import { buildApp } from "./app.js";

export async function startServer(): Promise<void> {
  const app = buildApp();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ host: "0.0.0.0", port });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
