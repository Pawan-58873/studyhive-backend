import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../config/firebase', () => ({
  auth: {
    verifyIdToken: vi.fn(),
  },
}));

import { auth } from '../config/firebase';
import { checkAuth } from './auth.middleware';

type MockResponse = {
  status: Mock;
  send: Mock;
};

const createMockRes = (): MockResponse & Response => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  return res;
};

describe('checkAuth middleware', () => {
  // Use non-null assertion since auth is mocked in this test
  if (!auth) {
    throw new Error("Firebase auth is not initialized in test");
  }

  const verifyIdTokenMock = auth!.verifyIdToken as unknown as Mock;

  beforeEach(() => {
    verifyIdTokenMock.mockReset();
  });

  it('returns 401 when no Authorization header is provided', async () => {
    const req = {
      headers: {},
    } as unknown as Request;
    const res = createMockRes();
    const next = vi.fn() as NextFunction;

    await checkAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.send).toHaveBeenCalledWith({
      error: 'Unauthorized: No token provided.',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when token is invalid (verifyIdToken throws)', async () => {
    const req = {
      headers: {
        authorization: 'Bearer invalid-token',
      },
    } as unknown as Request;
    const res = createMockRes();
    const next = vi.fn() as NextFunction;

    verifyIdTokenMock.mockRejectedValue(new Error('invalid token'));

    await checkAuth(req, res, next);

    expect(verifyIdTokenMock).toHaveBeenCalledWith('invalid-token');
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).toHaveBeenCalledWith({
      error: 'Forbidden: Invalid token.',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when email is not verified', async () => {
    const req = {
      headers: {
        authorization: 'Bearer some-token',
      },
    } as unknown as Request;
    const res = createMockRes();
    const next = vi.fn() as NextFunction;

    verifyIdTokenMock.mockResolvedValue({
      uid: 'u1',
      email: 'a@b.com',
      email_verified: false,
    });

    await checkAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).toHaveBeenCalledWith({
      error: 'Forbidden: Email not verified.',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next and attaches user when token is valid and email is verified', async () => {
    const req = {
      headers: {
        authorization: 'Bearer good-token',
      },
    } as unknown as Request;
    const res = createMockRes();
    const next = vi.fn() as NextFunction;

    verifyIdTokenMock.mockResolvedValue({
      uid: 'u1',
      email: 'a@b.com',
      email_verified: true,
    });

    await checkAuth(req, res, next);

    expect(verifyIdTokenMock).toHaveBeenCalledWith('good-token');
    expect(res.status).not.toHaveBeenCalled();
    expect((req as any).user).toEqual({ uid: 'u1', email: 'a@b.com' });
    expect(next).toHaveBeenCalled();
  });
});
