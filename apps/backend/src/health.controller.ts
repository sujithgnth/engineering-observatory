import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from "@nestjs/common";

import { ObservatoryStore } from "@engineering-observatory/persistence";

import { STORE } from "./tokens";

@Controller("health")
export class HealthController {
  constructor(@Inject(STORE) private readonly store: ObservatoryStore) {}

  @Get("live")
  live() {
    return {
      status: "ok" as const,
      service: "engineering-observatory-backend",
      version: "0.1.0",
      time: new Date().toISOString(),
    };
  }

  @Get("ready")
  async ready() {
    try {
      await this.store.health();
      return {
        status: "ok" as const,
        checks: { process: "ready", postgres: "ready" },
        time: new Date().toISOString(),
      };
    } catch {
      throw new ServiceUnavailableException("PostgreSQL is unavailable");
    }
  }
}
