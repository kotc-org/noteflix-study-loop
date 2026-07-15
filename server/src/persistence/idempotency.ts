import type { Firestore } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

import type { AppConfig } from "../config.js";
import { hashOpaque, opaqueToken } from "../security/crypto.js";
import type { CreatedPrivateNote, NoteflixApiError } from "../noteflix/client.js";

type SafeError = {
  code: string;
  message: string;
  retryable: boolean;
};

type IdempotencyRecord = {
  uidHash: string;
  requestId: string;
  inputHash: string;
  status: "pending" | "succeeded" | "failed";
  leaseId: string;
  leaseExpiresAtMs: number;
  createdAtMs: number;
  updatedAtMs: number;
  result?: CreatedPrivateNote;
  error?: SafeError;
};

export type Reservation =
  | { type: "acquired"; leaseId: string }
  | { type: "cached"; result: CreatedPrivateNote }
  | { type: "failed"; error: SafeError }
  | { type: "conflict" }
  | { type: "pending"; abandoned: boolean };

export interface IdempotencyStore {
  reserve(uid: string, requestId: string, inputHash: string): Promise<Reservation>;
  succeed(uid: string, requestId: string, leaseId: string, result: CreatedPrivateNote): Promise<void>;
  fail(uid: string, requestId: string, leaseId: string, error: SafeError): Promise<void>;
}

export class IdempotencyError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export function privateNoteInputHash(input: {
  title: string;
  content_markdown: string;
  summary?: string;
  key_points?: string[];
}): string {
  return hashOpaque(
    JSON.stringify({
      title: input.title,
      content_markdown: input.content_markdown,
      summary: input.summary ?? null,
      key_points: input.key_points ?? null,
    }),
  );
}

export class FirestoreIdempotencyStore implements IdempotencyStore {
  private readonly collection: string;

  constructor(
    private readonly db: Firestore,
    config: AppConfig,
    private readonly now: () => number = Date.now,
  ) {
    this.collection = `${config.collectionPrefix}_idempotency`;
  }

  async reserve(uid: string, requestId: string, inputHash: string): Promise<Reservation> {
    const ref = this.db.collection(this.collection).doc(hashOpaque(`${uid}:${requestId}`));
    const leaseId = opaqueToken(18);
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const now = this.now();
      if (snapshot.exists) {
        const current = snapshot.data() as IdempotencyRecord;
        if (current.inputHash !== inputHash) return { type: "conflict" };
        if (current.status === "succeeded" && current.result) return { type: "cached", result: current.result };
        if (current.status === "failed" && current.error) {
          if (!current.error.retryable) return { type: "failed", error: current.error };
          transaction.update(ref, {
            status: "pending",
            leaseId,
            leaseExpiresAtMs: now + 120_000,
            updatedAtMs: now,
            error: FieldValue.delete(),
          });
          return { type: "acquired", leaseId };
        }
        return { type: "pending", abandoned: current.leaseExpiresAtMs <= now };
      }
      const record: IdempotencyRecord = {
        uidHash: hashOpaque(uid),
        requestId,
        inputHash,
        status: "pending",
        leaseId,
        leaseExpiresAtMs: now + 120_000,
        createdAtMs: now,
        updatedAtMs: now,
      };
      transaction.create(ref, {
        ...record,
        deleteAfter: Timestamp.fromMillis(now + 30 * 24 * 60 * 60 * 1000),
      });
      return { type: "acquired", leaseId };
    });
  }

  async succeed(
    uid: string,
    requestId: string,
    leaseId: string,
    result: CreatedPrivateNote,
  ): Promise<void> {
    await this.finish(uid, requestId, leaseId, { status: "succeeded", result });
  }

  async fail(uid: string, requestId: string, leaseId: string, error: SafeError): Promise<void> {
    await this.finish(uid, requestId, leaseId, { status: "failed", error });
  }

  private async finish(
    uid: string,
    requestId: string,
    leaseId: string,
    update:
      | { status: "succeeded"; result: CreatedPrivateNote }
      | { status: "failed"; error: SafeError },
  ): Promise<void> {
    const ref = this.db.collection(this.collection).doc(hashOpaque(`${uid}:${requestId}`));
    await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new Error("Idempotency reservation is missing");
      const current = snapshot.data() as IdempotencyRecord;
      if (current.status !== "pending" || current.leaseId !== leaseId) {
        throw new Error("Idempotency reservation no longer belongs to this request");
      }
      transaction.update(ref, { ...update, updatedAtMs: this.now() });
    });
  }
}

export class IdempotencyCoordinator {
  constructor(private readonly store: IdempotencyStore) {}

  async run(input: {
    uid: string;
    requestId: string;
    inputHash: string;
    operation: () => Promise<CreatedPrivateNote>;
  }): Promise<{ result: CreatedPrivateNote; cached: boolean }> {
    const reservation = await this.store.reserve(input.uid, input.requestId, input.inputHash);
    if (reservation.type === "cached") return { result: reservation.result, cached: true };
    if (reservation.type === "failed") {
      throw new IdempotencyError(reservation.error.code, reservation.error.message, reservation.error.retryable);
    }
    if (reservation.type === "conflict") {
      throw new IdempotencyError(
        "idempotency_conflict",
        "This request_id was already used with different note content. Use a fresh UUID.",
        false,
      );
    }
    if (reservation.type === "pending") {
      throw new IdempotencyError(
        reservation.abandoned ? "creation_outcome_unknown" : "creation_in_progress",
        reservation.abandoned
          ? "A previous attempt did not record its outcome. Check your Noteflix library before using a new request ID."
          : "This exact note creation is already in progress. Wait before checking again with the same request ID.",
        !reservation.abandoned,
      );
    }

    try {
      const result = await input.operation();
      await this.store.succeed(input.uid, input.requestId, reservation.leaseId, result);
      return { result, cached: false };
    } catch (cause) {
      const typed = cause as Partial<NoteflixApiError>;
      const safe: SafeError = {
        code: typeof typed.code === "string" ? typed.code : "note_creation_failed",
        message: cause instanceof Error ? cause.message : "Noteflix could not create the note.",
        retryable: typed.retryable === true,
      };
      await this.store.fail(input.uid, input.requestId, reservation.leaseId, safe);
      throw new IdempotencyError(safe.code, safe.message, safe.retryable);
    }
  }
}
