import { readFileSync } from "node:fs";

import { Body, Controller, Get, Post } from "@nestjs/common";

declare const orders: {
  find(filter: Record<string, unknown>): Promise<unknown[]>;
};

@Controller("orders")
export class OrdersController {
  @Get()
  list() {
    return orders.find({ tenantId: "demo" });
  }

  @Post()
  create(@Body() payload: any) {
    readFileSync("/tmp/observatory-fixture");
    return payload;
  }

  async suppressFailure() {
    try {
      await orders.find({ customerId: "demo" });
    } catch {
      console.error("fixture failure");
    }
  }
}

export const apiKey = "observatory-canary-not-a-real-key-12345";
