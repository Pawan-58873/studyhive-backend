import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response } from "express";

vi.mock("../utils/t5.js", () => ({
  generateSummary: vi.fn(),
  generateKeyPoints: vi.fn(),
}));

vi.mock("mammoth", () => ({
  default: {
    extractRawText: vi.fn(),
  },
}));

vi.mock("pdf-parse", () => ({
  default: vi.fn(),
}));

vi.mock("officeparser", () => ({
  default: {
    parseOfficeAsync: vi.fn(),
  },
}));

import { generateSummary, generateKeyPoints } from "../utils/t5.js";
import mammoth from "mammoth";
import pdf from "pdf-parse";
import officeParser from "officeparser";
import {
  summarizeContent,
  generateKeyPointsFromContent,
} from "./ai.controller";

describe("ai.controller - summarizeContent", () => {
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

  it("summarizes plain text without file", async () => {
    (generateSummary as any).mockResolvedValue("summary");

    const req = {
      body: { text: "Some content to summarize." },
      file: undefined,
    } as unknown as Request;

    await summarizeContent(req, res);

    expect(generateSummary).toHaveBeenCalledWith("Some content to summarize.");
    expect(status).toHaveBeenCalledWith(200);
    const payload = (json as any).mock.calls[0][0];
    expect(Array.isArray(payload)).toBe(true);
    expect(payload[0].summary_text).toBe("summary");
  });

  it("returns 400 when input text is too long", async () => {
    const longText = "x".repeat(100_001);
    const req = {
      body: { text: longText },
      file: undefined,
    } as unknown as Request;

    await summarizeContent(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      error: "Input text too long. Please provide a shorter document.",
    });
  });

  it("summarizes DOCX file", async () => {
    (mammoth as any).default.extractRawText.mockResolvedValue({
      value: "docx content",
    });
    (generateSummary as any).mockResolvedValue("docx summary");

    const req = {
      body: { text: "" },
      file: {
        mimetype:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        buffer: Buffer.from("fake"),
      },
    } as unknown as Request;

    await summarizeContent(req, res);

    expect(mammoth.default.extractRawText).toHaveBeenCalled();
    expect(generateSummary).toHaveBeenCalledWith("docx content");
    expect(status).toHaveBeenCalledWith(200);
  });

  it("summarizes PDF file", async () => {
    (pdf as any).mockResolvedValue({ text: "pdf content" });
    (generateSummary as any).mockResolvedValue("pdf summary");

    const req = {
      body: { text: "" },
      file: {
        mimetype: "application/pdf",
        buffer: Buffer.from("fake"),
      },
    } as unknown as Request;

    await summarizeContent(req, res);

    expect(pdf).toHaveBeenCalled();
    expect(generateSummary).toHaveBeenCalledWith("pdf content");
    expect(status).toHaveBeenCalledWith(200);
  });

  it("summarizes PPTX file", async () => {
    (officeParser as any).default.parseOfficeAsync.mockResolvedValue(
      "pptx content",
    );
    (generateSummary as any).mockResolvedValue("pptx summary");

    const req = {
      body: { text: "" },
      file: {
        mimetype:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        buffer: Buffer.from("fake"),
      },
    } as unknown as Request;

    await summarizeContent(req, res);

    expect(officeParser.default.parseOfficeAsync).toHaveBeenCalled();
    expect(generateSummary).toHaveBeenCalledWith("pptx content");
    expect(status).toHaveBeenCalledWith(200);
  });

  it("returns 400 for unsupported mimetype", async () => {
    const req = {
      body: { text: "" },
      file: {
        mimetype: "application/zip",
        buffer: Buffer.from("fake"),
      },
    } as unknown as Request;

    await summarizeContent(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      error: "Unsupported file type. Please upload a DOCX, PDF, or PPTX file.",
    });
  });

  it("returns 400 for empty input", async () => {
    const req = {
      body: { text: "   " },
      file: undefined,
    } as unknown as Request;

    await summarizeContent(req, res);

    expect(status).toHaveBeenCalledWith(400);
  });
});

describe("ai.controller - generateKeyPointsFromContent", () => {
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

  it("generates key points from plain text", async () => {
    (generateKeyPoints as any).mockResolvedValue("points");

    const req = {
      body: { text: "Some content" },
      file: undefined,
    } as unknown as Request;

    await generateKeyPointsFromContent(req, res);

    expect(generateKeyPoints).toHaveBeenCalledWith("Some content");
    expect(status).toHaveBeenCalledWith(200);
    const payload = (json as any).mock.calls[0][0];
    expect(payload.key_points).toBe("points");
  });

  it("returns 400 when input text is too long", async () => {
    const longText = "x".repeat(100_001);
    const req = {
      body: { text: longText },
      file: undefined,
    } as unknown as Request;

    await generateKeyPointsFromContent(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      error: "Input text too long. Please provide a shorter document.",
    });
  });
});

