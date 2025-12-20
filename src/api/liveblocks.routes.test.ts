import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response } from "express";

vi.mock("../config/firebase", () => ({
  auth: {
    getUser: vi.fn(),
  },
  db: {
    collection: vi.fn(),
  },
}));

vi.mock("@liveblocks/node", () => ({
  Liveblocks: vi.fn().mockImplementation(() => ({
    prepareSession: vi.fn(() => ({
      allow: vi.fn(),
      authorize: vi.fn().mockResolvedValue({ status: 200, body: { ok: true } }),
    })),
    getRoom: vi.fn().mockResolvedValue({ id: "room1" }),
  })),
}));

process.env.LIVEBLOCKS_SECRET_KEY = "test_secret_key";

import * as firebaseConfig from "../config/firebase";
import liveblocksRouter from "./liveblocks.routes";

describe("liveblocks.routes - auth group permissions", () => {
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

  it("allows access to group room when user has matching groupIds", async () => {
    (firebaseConfig.auth.getUser as any).mockResolvedValue({
      uid: "u1",
      email: "user@example.com",
      metadata: {
        creationTime: "now",
        lastSignInTime: "now",
      },
    });

    const userDocData = {
      role: "user",
      groupIds: ["g1"],
    };

    (firebaseConfig.db.collection as any).mockImplementation((name: string) => {
      if (name === "users") {
        return {
          doc: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              exists: true,
              data: () => userDocData,
            }),
          }),
        };
      }
      return { doc: vi.fn(), collection: vi.fn() };
    });

    const req = {
      body: { room: "group-g1" },
      user: { uid: "u1" },
    } as unknown as Request;

    const routeHandler = (liveblocksRouter as any).stack.find(
      (layer: any) => layer.route && layer.route.path === "/auth"
    ).route.stack[1].handle;

    await routeHandler(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ ok: true });
  });
});

