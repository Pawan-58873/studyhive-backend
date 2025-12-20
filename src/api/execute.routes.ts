import express from 'express';
import { executeCode } from '../controllers/execute.controller';

const router = express.Router();

// POST /api/execute - Execute code in various languages
router.post('/execute', executeCode);

export default router;
