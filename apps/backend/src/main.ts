import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import helmet from "helmet";

import { AppModule } from "./app.module";
import { ProblemDetailsFilter } from "./problem.filter";

function loadLocalEnvironment() {
  try {
    process.loadEnvFile?.(".env");
  } catch {
    // A local .env file is optional; deployment environments inject variables.
  }
}

export async function createApp() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.setGlobalPrefix("api/v1");
  app.use(helmet());
  app.enableCors({
    origin: process.env.FRONTEND_ORIGIN ?? "http://localhost:5173",
    credentials: true,
  });
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.enableShutdownHooks();
  return app;
}

async function bootstrap() {
  loadLocalEnvironment();
  const app = await createApp();
  await app.listen(Number(process.env.PORT ?? 3333), "127.0.0.1");
}

if (process.env.NODE_ENV !== "test") {
  void bootstrap();
}
