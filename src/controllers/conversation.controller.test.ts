import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response } from "express";

vi.mock("../config/firebase", () => ({
  db: {
    collection: vi.fn(),
    batch: vi.fn(),
  },
}));

import * as firebaseConfig from "../config/firebase";
import {
  getConversations,
  markAsRead,
  syncConversations,
} from "./conversation.controller";

describe("conversation.controller - getConversations", () => {
  const json = vi.fn();
  const status = vi.fn(() => ({ json } as unknown as Response));
  let res: Response;

  beforeEach(() => {
    json.mockReset();
    status.mockReset();
    res = { status } as unknown as Response;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes timestamps and sorts by newest first", async () => {
    const docs = [
      {
        id: "c1",
        data: () => ({
          name: "Old",
          timestamp: { toDate: () => new Date("2020-01-01T00:00:00Z") },
        }),
      },
      {
        id: "c2",
        data: () => ({
          name: "New",
          timestamp: { toDate: () => new Date("2021-01-01T00:00:00Z") },
        }),
      },
    ];

    (firebaseConfig.db.collection as any).mockReturnValue({
      doc: vi.fn().mockReturnValue({
        collection: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({ docs }),
        }),
      }),
    });

    const req = {
      user: { uid: "u1" },
    } as unknown as Request;

    await getConversations(req, res);

    expect(status).toHaveBeenCalledWith(200);
    const payload = (json as any).mock.calls[0][0];
    expect(payload[0].id).toBe("c2");
    expect(payload[1].id).toBe("c1");
    expect(typeof payload[0].timestamp).toBe("string");
  });
});

describe("conversation.controller - markAsRead", () => {
  const send = vi.fn();
  const status = vi.fn(() => ({ send } as unknown as Response));
  let res: Response;

  beforeEach(() => {
    send.mockReset();
    status.mockReset();
    res = { status } as unknown as Response;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("updates unreadCount to 0 for a conversation", async () => {
    const update = vi.fn().mockResolvedValue(undefined);

    (firebaseConfig.db.collection as any).mockReturnValue({
      doc: vi.fn().mockReturnValue({
        collection: vi.fn().mockReturnValue({
          doc: vi.fn().mockReturnValue({ update }),
        }),
      }),
    });

    const req = {
      user: { uid: "u1" },
      params: { conversationId: "c1" },
    } as unknown as Request;

    await markAsRead(req, res);

    expect(update).toHaveBeenCalledWith({ unreadCount: 0 });
    expect(status).toHaveBeenCalledWith(200);
  });

  it("still returns 200 even if update fails (missing doc)", async () => {
    const update = vi.fn().mockRejectedValue(new Error("missing"));

    (firebaseConfig.db.collection as any).mockReturnValue({
      doc: vi.fn().mockReturnValue({
        collection: vi.fn().mockReturnValue({
          doc: vi.fn().mockReturnValue({ update }),
        }),
      }),
    });

    const req = {
      user: { uid: "u1" },
      params: { conversationId: "c1" },
    } as unknown as Request;

    await markAsRead(req, res);

    expect(status).toHaveBeenCalledWith(200);
  });
});

describe("conversation.controller - syncConversations", () => {
  const json = vi.fn();
  const status = vi.fn(() => ({ json } as unknown as Response));
  let res: Response;

  beforeEach(() => {
    json.mockReset();
    status.mockReset();
    res = { status } as unknown as Response;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates missing group conversations with unreadCount 0", async () => {
    const batchSet = vi.fn();
    const batchCommit = vi.fn().mockResolvedValue(undefined);

    (firebaseConfig.db.batch as any).mockReturnValue({
      set: batchSet,
      commit: batchCommit,
    });

    const conversationsDocs = [
      { id: "g1" },
    ];

    const conversationsCollection = {
      get: vi.fn().mockResolvedValue({ docs: conversationsDocs }),
      doc: vi.fn().mockImplementation((id: string) => ({ id })),
    };

    const userDocRef = {
      get: vi.fn().mockResolvedValue({
        data: () => ({
          groupIds: ["g1", "g2"],
        }),
      }),
    };

    const groupDocRef = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          name: "Group 2",
          coverImage: "cover",
        }),
      }),
    };

    (firebaseConfig.db.collection as any).mockImplementation((name: string) => {
      if (name === "users") {
        return {
          doc: vi.fn().mockReturnValue({
            get: userDocRef.get,
            collection: vi.fn().mockReturnValue(conversationsCollection),
          }),
        };
      }
      if (name === "groups") {
        return {
          doc: vi.fn().mockReturnValue(groupDocRef),
        };
      }
      return { doc: vi.fn(), collection: vi.fn() };
    });

    const req = {
      user: { uid: "u1" },
    } as unknown as Request;

    await syncConversations(req, res);

    expect(batchSet).toHaveBeenCalled();
    const firstCallArgs = (batchSet as any).mock.calls[0][1];
    expect(firstCallArgs.unreadCount).toBe(0);
  });
});

