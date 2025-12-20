import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response } from "express";
import * as firebaseConfig from "../config/firebase";
import {
  getCurrentUser,
  updateUserProfile,
  changePassword,
  deleteAccount,
} from "./user.controller";

vi.mock("../config/firebase", () => ({
  db: {
    collection: vi.fn(),
  },
  auth: {},
}));

describe("user.controller - getCurrentUser", () => {
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

  it("returns 404 when user doc does not exist", async () => {
    const docRef = {
      get: vi.fn().mockResolvedValue({ exists: false }),
    };

    (firebaseConfig.db.collection as any).mockReturnValue({
      doc: vi.fn().mockReturnValue(docRef),
    });

    const req = { user: { uid: "user1" } } as unknown as Request;

    await getCurrentUser(req, res);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({ error: "User not found." });
  });

  it("returns sanitized user data when doc exists", async () => {
    const userDoc = {
      id: "user1",
      exists: true,
      data: () => ({
        username: "john",
        email: "john@example.com",
        firstName: "John",
        lastName: "Doe",
        bio: "Hi",
        profileImageUrl: "http://image",
        role: "user",
        createdAt: "ts" as any,
      }),
    };

    const docRef = {
      get: vi.fn().mockResolvedValue(userDoc),
    };

    (firebaseConfig.db.collection as any).mockReturnValue({
      doc: vi.fn().mockReturnValue(docRef),
    });

    const req = { user: { uid: "user1" } } as unknown as Request;

    await getCurrentUser(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({
      id: "user1",
      username: "john",
      email: "john@example.com",
      firstName: "John",
      lastName: "Doe",
      bio: "Hi",
      profileImageUrl: "http://image",
      role: "user",
      createdAt: "ts",
    });
  });
});

describe("user.controller - updateUserProfile", () => {
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

  it("rejects too-long bio with 400", async () => {
    const update = vi.fn();
    const get = vi.fn().mockResolvedValue({
      exists: true,
      data: () => ({
        username: "john",
        email: "john@example.com",
      }),
    });

    (firebaseConfig.db.collection as any).mockImplementation((name: string) => {
      if (name === "users") {
        return {
          doc: vi.fn().mockReturnValue({ update, get }),
        };
      }
      return { doc: vi.fn() };
    });

    const req = {
      user: { uid: "user1" },
      body: { bio: "x".repeat(1001) },
    } as unknown as Request;

    await updateUserProfile(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      error: "Bio must be at most 1000 characters long.",
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("trims leading/trailing spaces on names and bio", async () => {
    const update = vi.fn();
    const get = vi.fn().mockResolvedValue({
      exists: true,
      data: () => ({
        username: "john",
        email: "john@example.com",
      }),
    });

    (firebaseConfig.db.collection as any).mockImplementation((name: string) => {
      if (name === "users") {
        return {
          doc: vi.fn().mockReturnValue({ update, get }),
        };
      }
      return { doc: vi.fn() };
    });

    const req = {
      user: { uid: "user1" },
      body: {
        firstName: "  John ",
        lastName: " Doe  ",
        bio: "  Hello there ",
      },
      file: undefined,
    } as unknown as Request;

    await updateUserProfile(req, res);

    expect(update).toHaveBeenCalled();
    const updatesArg = (update as any).mock.calls[0][0];
    expect(updatesArg.firstName).toBe("John");
    expect(updatesArg.lastName).toBe("Doe");
    expect(updatesArg.bio).toBe("Hello there");
  });
});

describe("user.controller - deleteAccount", () => {
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

  it("deletes username mapping when account is deleted", async () => {
    const deleteUser = vi.fn().mockResolvedValue(undefined);
    (firebaseConfig.auth as any).deleteUser = deleteUser;

    const userDocRef = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () =>
          ({
            username: "JohnDoe",
            email: "john@example.com",
          } as any),
      }),
      delete: vi.fn().mockResolvedValue(undefined),
    };

    const usernamesDocDelete = vi.fn().mockResolvedValue(undefined);

    (firebaseConfig.db.collection as any).mockImplementation((name: string) => {
      if (name === "users") {
        return {
          doc: vi.fn().mockReturnValue(userDocRef),
        };
      }
      if (name === "usernames") {
        return {
          doc: vi.fn().mockReturnValue({
            delete: usernamesDocDelete,
          }),
        };
      }
      return { doc: vi.fn() };
    });

    const req = { user: { uid: "user1" } } as unknown as Request;

    await deleteAccount(req, res);

    expect(deleteUser).toHaveBeenCalledWith("user1");
    expect(userDocRef.delete).toHaveBeenCalled();
    expect(usernamesDocDelete).toHaveBeenCalled();
  });
});

