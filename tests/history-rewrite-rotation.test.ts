import { describe, expect, it } from "vitest";

import { fingerprintCompletedTurns, fingerprintRequestMessages } from "../src/stream/recovery.js";
import { discardStaleCheckpointIfNeeded } from "../src/stream/session-state.js";
import type { StoredConversation } from "../src/stream/types.js";

function msg(role: string, text: string): { role: string; content: unknown } {
  return { role, content: text };
}

function storedWithCheckpoint(): StoredConversation {
  return {
    conversationId: "conv-1",
    // Empty bytes decode as a default protobuf message — valid but content-free.
    checkpoint: new Uint8Array(0),
    checkpointTurnCount: 0,
    checkpointHistoryFingerprint: fingerprintCompletedTurns([]),
    sessionScoped: false,
    blobStore: new Map(),
    lastAccessMs: Date.now(),
  };
}

describe("history-rewrite detection via request message prefix", () => {
  it("rotates the conversation when the client rewrote history (shorter prefix)", () => {
    const stored = storedWithCheckpoint();
    const before = [
      msg("system", "sys"),
      msg("user", "u1"),
      msg("assistant", "a1"),
      msg("user", "u2"),
    ];
    discardStaleCheckpointIfNeeded(stored, [], "req-1", "conv-a", before);

    // Compaction rewrote the prefix: fewer messages, different content.
    const after = [msg("system", "sys"), msg("user", "summary + u2")];
    discardStaleCheckpointIfNeeded(stored, [], "req-2", "conv-a", after);

    expect(stored.conversationId).not.toBe("conv-1");
    expect(stored.checkpoint).toBeNull();
  });

  it("keeps the conversation when the request only extends the previous one", () => {
    const stored = storedWithCheckpoint();
    const before = [msg("system", "sys"), msg("user", "u1")];
    discardStaleCheckpointIfNeeded(stored, [], "req-1", "conv-b", before);

    const extended = [...before, msg("assistant", "a1"), msg("tool", "t1")];
    discardStaleCheckpointIfNeeded(stored, [], "req-2", "conv-b", extended);

    expect(stored.conversationId).toBe("conv-1");
    expect(stored.checkpoint).not.toBeNull();
  });

  it("detects a divergent prefix even when the message count grows", () => {
    const stored = storedWithCheckpoint();
    const before = [msg("system", "sys"), msg("user", "u1"), msg("assistant", "a1")];
    discardStaleCheckpointIfNeeded(stored, [], "req-1", "conv-c", before);

    // Same length prefix but rewritten content (compaction folding a summary in).
    const after = [
      msg("system", "sys"),
      msg("user", "rewritten"),
      msg("tool", "t1"),
      msg("user", "u2"),
    ];
    discardStaleCheckpointIfNeeded(stored, [], "req-2", "conv-c", after);

    expect(stored.conversationId).not.toBe("conv-1");
    expect(stored.checkpoint).toBeNull();
  });

  it("records the fingerprint on first sight without rotating", () => {
    const stored = storedWithCheckpoint();
    const messages = [msg("system", "sys"), msg("user", "u1")];

    discardStaleCheckpointIfNeeded(stored, [], "req-1", "conv-d", messages);

    expect(stored.conversationId).toBe("conv-1");
    expect(stored.checkpoint).not.toBeNull();
    expect(stored.lastRequestMessageCount).toBe(2);
    expect(stored.lastRequestMessageFingerprint).toBe(fingerprintRequestMessages(messages));
  });
});
