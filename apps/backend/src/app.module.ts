import { Module } from "@nestjs/common";

import {
  ArchitectureGraphStore,
  ObservatoryStore,
} from "@engineering-observatory/persistence";
import { LocalArtifactStore } from "@engineering-observatory/scanners";

import { AIController } from "./ai.controller";
import { ArchitectureController } from "./architecture.controller";
import { HealthController } from "./health.controller";
import { PerformanceController } from "./performance.controller";
import { RepositoriesController } from "./repositories.controller";
import { ARCHITECTURE_STORE, ARTIFACT_STORE, STORE } from "./tokens";

@Module({
  controllers: [
    HealthController,
    RepositoriesController,
    ArchitectureController,
    AIController,
    PerformanceController,
  ],
  providers: [
    { provide: STORE, useFactory: () => ObservatoryStore.fromEnvironment() },
    {
      provide: ARCHITECTURE_STORE,
      useFactory: () => ArchitectureGraphStore.fromEnvironment(),
    },
    { provide: ARTIFACT_STORE, useFactory: () => new LocalArtifactStore() },
  ],
})
export class AppModule {}
