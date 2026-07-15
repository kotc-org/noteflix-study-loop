import { describe, expect, it } from "vitest";

import {
  IdempotencyCoordinator,
  IdempotencyError,
  type IdempotencyStore,
  privateNoteInputHash,
  type Reservation,
} from "../src/persistence/idempotency.js";

const note = {
  id: "note-1",
  title: "Cells",
  slug: "cells",
  url: "https://noteflix.test/ai-notetaker/notes/cells",
  visibility: "private" as const,
};

class MemoryStore implements IdempotencyStore {
  state: Reservation = { type: "acquired", leaseId: "lease-1" };
  reserveCalls = 0;

  async reserve(): Promise<Reservation> {
    this.reserveCalls += 1;
    if (this.state.type === "failed" && this.state.error.retryable) {
      this.state = { type: "acquired", leaseId: `lease-${this.reserveCalls}` };
    }
    return this.state;
  }
  async succeed(_uid: string, _requestId: string, _leaseId: string, result: typeof note): Promise<void> {
    this.state = { type: "cached", result };
  }
  async fail(
    _uid: string,
    _requestId: string,
    _leaseId: string,
    error: { code: string; message: string; retryable: boolean },
  ): Promise<void> {
    this.state = { type: "failed", error };
  }
}

describe("idempotency coordinator", () => {
  const base = {
    uid: "user-1",
    requestId: "550e8400-e29b-41d4-a716-446655440000",
    inputHash: privateNoteInputHash({ title: "Cells", content_markdown: "Cell notes" }),
  };

  it("returns the stored result without performing the mutation twice", async () => {
    const store = new MemoryStore();
    const coordinator = new IdempotencyCoordinator(store);
    let calls = 0;
    const first = await coordinator.run({ ...base, operation: async () => { calls += 1; return note; } });
    const second = await coordinator.run({ ...base, operation: async () => { calls += 1; return note; } });
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(calls).toBe(1);
  });

  it("reacquires retryable pre-request failures", async () => {
    const store = new MemoryStore();
    const coordinator = new IdempotencyCoordinator(store);
    await expect(
      coordinator.run({
        ...base,
        operation: async () => {
          const error = new Error("Token exchange unavailable") as Error & { code: string; retryable: boolean };
          error.code = "firebase_token_exchange_failed";
          error.retryable = true;
          throw error;
        },
      }),
    ).rejects.toBeInstanceOf(IdempotencyError);
    const retried = await coordinator.run({ ...base, operation: async () => note });
    expect(retried.result.id).toBe("note-1");
  });

  it("does not repeat an outcome-unknown request", async () => {
    const store = new MemoryStore();
    store.state = {
      type: "failed",
      error: { code: "noteflix_unreachable", message: "Check the library.", retryable: false },
    };
    const coordinator = new IdempotencyCoordinator(store);
    let called = false;
    await expect(coordinator.run({ ...base, operation: async () => { called = true; return note; } })).rejects.toMatchObject({
      code: "noteflix_unreachable",
      retryable: false,
    });
    expect(called).toBe(false);
  });
});
