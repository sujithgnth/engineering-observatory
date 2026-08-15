import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";

import { AppModule } from "./app.module";
import { ARCHITECTURE_STORE, ARTIFACT_STORE, STORE } from "./tokens";

describe("health API", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(STORE)
      .useValue({})
      .overrideProvider(ARTIFACT_STORE)
      .useValue({})
      .overrideProvider(ARCHITECTURE_STORE)
      .useValue({})
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
  });

  afterAll(async () => app.close());

  it("reports liveness", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/health/live")
      .expect(200);
    expect(response.body).toMatchObject({
      status: "ok",
      service: "engineering-observatory-backend",
    });
  });
});
