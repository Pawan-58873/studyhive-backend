import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response } from "express";

vi.mock("../config/firebase", () => ({
  db: {
    collection: vi.fn(),
  },
}));

import * as firebaseConfig from "../config/firebase";
import {
  createSession,
  getGroupSessions,
} from "./session.controller";

describe("session.controller - createSession", () => {
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

  it("creates a session successfully and returns 201", async () => {
    const add = vi.fn().mockResolvedValue({ id: "session1" });

    (firebaseConfig.db.collection as any).mockReturnValue({
      add,
    });

    const req = {
      body: {
        title: "Study",
        description: "Math",
        groupId: "g1",
        creatorId: "u1",
        startTime: new Date().toISOString(),
      },
    } as unknown as Request;

    await createSession(req, res);

    expect(status).toHaveBeenCalledWith(201);
    expect(json).toHaveBeenCalled();
  });

  it("returns 400 on invalid payload (missing title)", async () => {
    const add = vi.fn();

    (firebaseConfig.db.collection as any).mockReturnValue({
      add,
    });

    const req = {
      body: {
        // title missing
        description: "Math",
        groupId: "g1",
        creatorId: "u1",
        startTime: new Date().toISOString(),
      },
    } as unknown as Request;

    await createSession(req, res);

    // ZodError should map to 400
    expect(status).toHaveBeenCalledWith(400);
  });
});

describe("session.controller - getGroupSessions", () => {
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

  it("filters by groupId and orders by startTime", async () => {
    const docs = [
      { id: "s1", data: () => ({ groupId: "g1", startTime: { toDate: () => new Date("2024-01-01") } }) },
      { id: "s2", data: () => ({ groupId: "g1", startTime: { toDate: () => new Date("2024-01-02") } }) },
    ];

    const get = vi.fn().mockResolvedValue({ empty: false, docs });
    const orderBy = vi.fn().mockReturnValue({ get });
    const where = vi.fn().mockReturnValue({ where, orderBy });

    (firebaseConfig.db.collection as any).mockReturnValue({
      where,
      orderBy,
      get,
    });

    const req = {
      query: {
        groupId: "g1",
      },
    } as unknown as Request;

    await getGroupSessions(req, res);

    expect(where).toHaveBeenCalledWith("groupId", "==", "g1");
    expect(orderBy).toHaveBeenCalledWith("startTime", "asc");
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalled();
  });
});

