import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response } from "express";

vi.mock("../config/firebase", () => ({
  db: {
    collection: vi.fn(),
  },
}));

import * as firebaseConfig from "../config/firebase";
import { sendChatMessage, getChatMessages } from "./chat.controller";

describe("chat.controller - sendChatMessage validation", () => {
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

  it("returns 400 when content is empty", async () => {
    const req = {
      user: { uid: "u1" },
      params: { chatId: "chat1" },
      body: { content: "   " },
    } as unknown as Request;

    await sendChatMessage(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(send).toHaveBeenCalledWith({
      error: "Message content is required.",
    });
  });

  it("returns 400 when content is too long", async () => {
    const longContent = "x".repeat(5001);
    const req = {
      user: { uid: "u1" },
      params: { chatId: "chat1" },
      body: { content: longContent },
    } as unknown as Request;

    await sendChatMessage(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(send).toHaveBeenCalledWith({
      error: "Message too long.",
    });
  });
});

describe("chat.controller - getChatMessages timestamp normalization", () => {
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

  it("handles missing or malformed createdAt without throwing", async () => {
    const docs = [
      {
        id: "m1",
        data: () => ({ content: "hello", createdAt: { toDate: () => new Date("2020-01-01T00:00:00Z") } }),
      },
      {
        id: "m2",
        data: () => ({ content: "no timestamp" }),
      },
    ];

    (firebaseConfig.db.collection as any).mockReturnValue({
      doc: vi.fn().mockReturnValue({
        collection: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({ docs }),
          }),
        }),
      }),
    });

    const req = {
      params: { chatId: "chat1" },
    } as unknown as Request;

    await getChatMessages(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalled();
    const payload = (json as any).mock.calls[0][0];
    expect(Array.isArray(payload)).toBe(true);
    expect(payload[0].createdAt).toBeTruthy();
    expect(payload[1].createdAt).toBeTruthy();
  });
});

