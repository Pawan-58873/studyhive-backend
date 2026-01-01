import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response } from "express";

vi.mock("../config/firebase", () => ({
  db: {
    collection: vi.fn(),
    batch: vi.fn(),
  },
  admin: {
    firestore: {
      FieldPath: {
        documentId: () => "documentId",
      },
    },
  },
}));

import * as firebaseConfig from "../config/firebase";
import {
  createGroup,
  joinGroup,
  leaveGroup,
  deleteGroup,
} from "./group.controller";

describe("group.controller - createGroup", () => {
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

  it("returns 404 when creator user not found", async () => {
    const userDocRef = {
      get: vi.fn().mockResolvedValue({ exists: false }),
    };

    // Use non-null assertion since db is mocked in this test
    if (!firebaseConfig.db) {
      throw new Error("Firebase db is not initialized in test");
    }

    (firebaseConfig.db!.collection as any).mockImplementation((name: string) => {
      if (name === "users") {
        return {
          doc: vi.fn().mockReturnValue(userDocRef),
        };
      }
      return { doc: vi.fn() };
    });

    const req = {
      user: { uid: "creator1" },
      body: {
        name: "Test Group",
        description: "Desc",
        privacy: "public",
      },
    } as unknown as Request;

    await createGroup(req, res);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      error: "Creator user profile not found.",
    });
  });
});

describe("group.controller - joinGroup", () => {
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

  it("returns 404 when invite code is invalid", async () => {
    const where = vi.fn().mockReturnThis();
    const limit = vi.fn().mockReturnThis();
    const get = vi.fn().mockResolvedValue({ empty: true });

    // Use non-null assertion since db is mocked in this test
    if (!firebaseConfig.db) {
      throw new Error("Firebase db is not initialized in test");
    }

    (firebaseConfig.db!.collection as any).mockImplementation((name: string) => {
      if (name === "groups") {
        return { where, limit, get };
      }
      return { doc: vi.fn(), collection: vi.fn() };
    });

    const req = {
      user: { uid: "user1" },
      body: { inviteCode: "INVALID" },
    } as unknown as Request;

    await joinGroup(req, res);

    expect(status).toHaveBeenCalledWith(404);
    expect(send).toHaveBeenCalledWith({
      error: "Invalid invite code. Group not found.",
    });
  });
});

describe("group.controller - leaveGroup", () => {
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

  it("prevents leaving when user is the only admin", async () => {
    const groupMembersCollection = {
      doc: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ role: "admin" }),
        }),
      }),
      where: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({
          size: 1,
        }),
      }),
    };

    // Use non-null assertion since db is mocked in this test
    if (!firebaseConfig.db) {
      throw new Error("Firebase db is not initialized in test");
    }

    (firebaseConfig.db!.collection as any).mockImplementation((name: string) => {
      if (name === "groups") {
        return {
          doc: vi.fn().mockReturnValue({
            collection: (sub: string) =>
              sub === "members" ? groupMembersCollection : { get: vi.fn() },
          }),
        };
      }
      return { doc: vi.fn(), collection: vi.fn() };
    });

    const req = {
      user: { uid: "admin1" },
      params: { groupId: "group1" },
    } as unknown as Request;

    await leaveGroup(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(send).toHaveBeenCalledWith({
      error:
        "Cannot leave group as the only admin. Please delete the group or assign another admin first.",
    });
  });
});

describe("group.controller - deleteGroup", () => {
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

  it("deletes member and message subcollections along with group", async () => {
    const batchDelete = vi.fn();
    const batchUpdate = vi.fn();
    const commit = vi.fn().mockResolvedValue(undefined);

    // Use non-null assertion since db is mocked in this test
    if (!firebaseConfig.db) {
      throw new Error("Firebase db is not initialized in test");
    }

    (firebaseConfig.db!.batch as any).mockReturnValue({
      delete: batchDelete,
      update: batchUpdate,
      commit,
    });

    const membersDocs = [
      { id: "u1", ref: { id: "memberDoc1" } },
      { id: "u2", ref: { id: "memberDoc2" } },
    ];
    const messagesDocs = [
      { ref: { id: "msg1" } },
      { ref: { id: "msg2" } },
    ];

    const groupDocRef = {
      collection: (sub: string) => {
        if (sub === "members") {
          return {
            get: vi.fn().mockResolvedValue({ docs: membersDocs } as any),
          };
        }
        if (sub === "messages") {
          return {
            get: vi.fn().mockResolvedValue({ docs: messagesDocs } as any),
          };
        }
        return { get: vi.fn() };
      },
    };

    // Use non-null assertion since db is mocked in this test
    if (!firebaseConfig.db) {
      throw new Error("Firebase db is not initialized in test");
    }

    (firebaseConfig.db!.collection as any).mockImplementation((name: string) => {
      if (name === "groups") {
        return {
          doc: vi.fn().mockReturnValue(groupDocRef),
        };
      }
      if (name === "users") {
        return {
          doc: vi.fn().mockReturnValue({
            collection: vi.fn().mockReturnValue({
              doc: vi.fn().mockReturnValue({}),
            }),
          }),
        };
      }
      return { doc: vi.fn(), collection: vi.fn() };
    });

    const memberDoc = {
      exists: true,
      data: () => ({ role: "admin" }),
    };

    (groupDocRef.collection("members") as any).doc = vi.fn().mockReturnValue({
      get: vi.fn().mockResolvedValue(memberDoc),
    });

    const req = {
      user: { uid: "u1" },
      params: { groupId: "group1" },
    } as unknown as Request;

    await deleteGroup(req, res);

    // Expect batch.delete called for members, messages and the group doc itself
    expect(batchDelete).toHaveBeenCalled();
    expect(commit).toHaveBeenCalled();
  });
});

