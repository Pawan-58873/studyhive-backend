import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

vi.mock("../config/firebase", () => ({
  db: {
    collection: vi.fn(),
  },
  auth: {},
}));

import * as firebaseConfig from "../config/firebase";
import { ensureAdmin } from "./admin.routes";

describe("admin.routes - ensureAdmin", () => {
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

  it("returns 403 when user is not admin", async () => {
    const get = vi.fn().mockResolvedValue({
      exists: true,
      data: () => ({ role: "user" }),
    });

    (firebaseConfig.db.collection as any).mockReturnValue({
      doc: vi.fn().mockReturnValue({ get }),
    });

    const req = {
      user: { uid: "user1" },
    } as unknown as Request;
    const next = vi.fn() as NextFunction;

    await ensureAdmin(req, res, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ error: "Admin access required" });
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next when user is admin", async () => {
    const get = vi.fn().mockResolvedValue({
      exists: true,
      data: () => ({ role: "admin" }),
    });

    (firebaseConfig.db.collection as any).mockReturnValue({
      doc: vi.fn().mockReturnValue({ get }),
    });

    const req = {
      user: { uid: "admin1" },
    } as unknown as Request;
    const next = vi.fn() as NextFunction;

    await ensureAdmin(req, res, next);

    expect(status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});

