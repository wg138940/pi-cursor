import { beforeEach, describe, expect, it } from "vitest";

import type { BridgeHandle } from "../src/client/bridge.js";
import {
  destroyIdleBridgesWhere,
  idleBridges,
  parkIdleBridge,
} from "../src/stream/bridge-session.js";

function fakeBridge(): {
  handle: BridgeHandle;
  ended: () => boolean;
  unrefs: () => number;
} {
  let alive = true;
  let unrefCount = 0;
  const handle = {
    proc: { kill: () => true },
    get alive() {
      return alive;
    },
    lastStderr: () => "",
    write: () => {},
    openStream: () => {},
    end: () => {
      alive = false;
    },
    onData: () => {},
    onStreamDone: () => {},
    onClose: () => {},
    onError: () => {},
    unref: () => {
      unrefCount += 1;
    },
    ref: () => {},
  } as unknown as BridgeHandle;
  return { handle, ended: () => !alive, unrefs: () => unrefCount };
}

/** Mirrors the sweep predicate used by cleanupSessionState. */
function sweepFor(sessionId: string): number {
  return destroyIdleBridgesWhere((scope) => !scope?.sessionScoped || scope.sessionId === sessionId);
}

describe("parked-bridge sweep at session cleanup", () => {
  beforeEach(() => {
    destroyIdleBridgesWhere(() => true);
    idleBridges.clear();
  });

  it("destroys orphan (session-less) parked bridges so the process can exit", () => {
    const orphan = fakeBridge();
    parkIdleBridge("orphan-key", orphan.handle, { sessionScoped: false });

    const destroyed = sweepFor("s1");

    expect(destroyed).toBe(1);
    expect(orphan.ended()).toBe(true);
    expect(idleBridges.has("orphan-key")).toBe(false);
  });

  it("destroys this session's bridges but keeps other sessions' parked bridges", () => {
    const mine = fakeBridge();
    const other = fakeBridge();
    parkIdleBridge("mine", mine.handle, { sessionScoped: true, sessionId: "s1" });
    parkIdleBridge("other", other.handle, { sessionScoped: true, sessionId: "s2" });

    const destroyed = sweepFor("s1");

    expect(destroyed).toBe(1);
    expect(mine.ended()).toBe(true);
    expect(other.ended()).toBe(false);
    expect(idleBridges.has("other")).toBe(true);
  });

  it("treats an unscoped parked bridge as orphaned", () => {
    const unscoped = fakeBridge();
    parkIdleBridge("unscoped", unscoped.handle);

    expect(sweepFor("s1")).toBe(1);
    expect(unscoped.ended()).toBe(true);
  });

  it("is idempotent when the session cleans up twice", () => {
    const orphan = fakeBridge();
    parkIdleBridge("orphan-key", orphan.handle, { sessionScoped: false });

    expect(sweepFor("s1")).toBe(1);
    expect(sweepFor("s1")).toBe(0);
    expect(orphan.ended()).toBe(true);
  });
  it("unrefs the transport handle on park so it cannot pin the process", () => {
    const parked = fakeBridge();
    parkIdleBridge("parked", parked.handle, { sessionScoped: false });
    expect(parked.unrefs()).toBe(1);
  });
});
