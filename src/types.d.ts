// This file provides custom type declarations for the server.

// Solution for Error 1:
// Manually declare modules that don't have official types.
// This tells TypeScript to not worry about their type and just let us use them.
declare module 'pdf-parse';
declare module 'mammoth';
declare module 'pptx-parser';
declare module 'node-fetch';

// Solution for Error 2:
// Extend the global Express Request interface to include the 'file' property,
// which is added by the Multer middleware for file uploads.
declare namespace Express {
  export interface Request {
    file?: Multer.File;
  }
}
