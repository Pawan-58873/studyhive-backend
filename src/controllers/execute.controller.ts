import { Request, Response } from 'express';
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);
const access = promisify(fs.access);

interface ExecuteRequest {
  code: string;
  language: string;
  input?: string;
}

interface ExecuteResult {
  output: string;
  error: string;
  executionTime: number;
  exitCode: number;
  success: boolean;
}

export const executeCode = async (req: Request, res: Response) => {
  try {
    const { code, language, input = '' }: ExecuteRequest = req.body;

    // Validation
    if (!code || !language) {
      return res.status(400).json({ 
        success: false,
        error: 'Code and language are required' 
      });
    }

    // Check if language is supported
    const supportedLanguages = ['javascript', 'typescript', 'python', 'java', 'cpp', 'csharp'];
    if (!supportedLanguages.includes(language)) {
      return res.status(400).json({ 
        success: false,
        error: `Unsupported language: ${language}. Supported languages: ${supportedLanguages.join(', ')}` 
      });
    }

    // Execute the code
    const result = await runCode(code, language, input);
    
    res.json({
      success: result.success,
      output: result.output,
      error: result.error,
      executionTime: result.executionTime,
      exitCode: result.exitCode
    });

  } catch (error) {
    console.error('Execution error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Execution failed', 
      message: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
};

const runCode = async (code: string, language: string, input: string): Promise<ExecuteResult> => {
  const executionId = uuidv4();
  const tempDir = path.join(__dirname, '../../temp');
  const filePath = path.join(tempDir, `${executionId}.${getFileExtension(language)}`);

  try {
    // Ensure temp directory exists
    await ensureTempDirectory(tempDir);

    // Write code to file
    await writeFile(filePath, code);

    const startTime = Date.now();
    const result = await executeByLanguage(filePath, language, input);
    const executionTime = Date.now() - startTime;

    return {
      ...result,
      executionTime,
      success: result.exitCode === 0
    };

  } catch (error) {
    throw error;
  } finally {
    // Clean up temp file
    try {
      await unlink(filePath);
    } catch (cleanupError) {
      console.warn('Failed to cleanup temp file:', cleanupError);
    }
  }
};

const ensureTempDirectory = async (tempDir: string): Promise<void> => {
  try {
    await access(tempDir);
  } catch {
    await mkdir(tempDir, { recursive: true });
  }
};

const executeByLanguage = (filePath: string, language: string, input: string): Promise<{
  output: string;
  error: string;
  exitCode: number;
}> => {
  return new Promise((resolve, reject) => {
    let command: string;
    let args: string[];

    switch (language) {
      case 'python':
        command = 'python3';
        args = [filePath];
        break;
      case 'java':
        // For Java, we need to compile first, then run
        compileAndRunJava(filePath, input)
          .then(resolve)
          .catch(reject);
        return;
      case 'cpp':
        // For C++, we need to compile first, then run
        compileAndRunCpp(filePath, input)
          .then(resolve)
          .catch(reject);
        return;
      case 'csharp':
        command = 'dotnet';
        args = ['run', filePath];
        break;
      case 'javascript':
        command = 'node';
        args = [filePath];
        break;
      case 'typescript':
        // For TypeScript, try ts-node first, then fallback to compilation
        executeTypeScript(filePath, input)
          .then(resolve)
          .catch(reject);
        return;
      default:
        reject(new Error(`Unsupported language: ${language}`));
        return;
    }

    const process = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000, // 10 second timeout
    });

    let output = '';
    let error = '';

    process.stdout.on('data', (data) => {
      output += data.toString();
    });

    process.stderr.on('data', (data) => {
      error += data.toString();
    });

    process.on('close', (code) => {
      resolve({
        output: output.trim(),
        error: error.trim(),
        exitCode: code || 0
      });
    });

    process.on('error', (err) => {
      reject(err);
    });

    // Send input if provided
    if (input) {
      process.stdin.write(input);
      process.stdin.end();
    }
  });
};

const compileAndRunJava = (filePath: string, input: string): Promise<{
  output: string;
  error: string;
  exitCode: number;
}> => {
  return new Promise((resolve, reject) => {
    const className = path.basename(filePath, '.java');
    const dir = path.dirname(filePath);
    
    // First compile
    const compileProcess = spawn('javac', [filePath], {
      cwd: dir,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    });

    let compileError = '';
    compileProcess.stderr.on('data', (data) => {
      compileError += data.toString();
    });

    compileProcess.on('close', (compileCode) => {
      if (compileCode !== 0) {
        resolve({
          output: '',
          error: `Compilation error: ${compileError}`,
          exitCode: compileCode ?? 0
        });
        return;
      }

      // Then run
      const runProcess = spawn('java', [className], {
        cwd: dir,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10000,
      });

      let output = '';
      let error = '';

      runProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      runProcess.stderr.on('data', (data) => {
        error += data.toString();
      });

      runProcess.on('close', (code) => {
        resolve({
          output: output.trim(),
          error: error.trim(),
          exitCode: code || 0
        });
      });

      runProcess.on('error', (err) => {
        reject(err);
      });

      if (input) {
        runProcess.stdin.write(input);
        runProcess.stdin.end();
      }
    });

    compileProcess.on('error', (err) => {
      reject(err);
    });
  });
};

const compileAndRunCpp = (filePath: string, input: string): Promise<{
  output: string;
  error: string;
  exitCode: number;
}> => {
  return new Promise((resolve, reject) => {
    const executablePath = filePath.replace('.cpp', '');
    
    // First compile
    const compileProcess = spawn('g++', ['-o', executablePath, filePath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    });

    let compileError = '';
    compileProcess.stderr.on('data', (data) => {
      compileError += data.toString();
    });

    compileProcess.on('close', (compileCode) => {
      if (compileCode !== 0) {
        resolve({
          output: '',
          error: `Compilation error: ${compileError}`,
          exitCode: compileCode ?? 0
        });
        return;
      }

      // Then run
      const runProcess = spawn(executablePath, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10000,
      });

      let output = '';
      let error = '';

      runProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      runProcess.stderr.on('data', (data) => {
        error += data.toString();
      });

      runProcess.on('close', (code) => {
        // Clean up executable
        try {
          fs.unlinkSync(executablePath);
        } catch (cleanupError) {
          console.warn('Failed to cleanup executable:', cleanupError);
        }

        resolve({
          output: output.trim(),
          error: error.trim(),
          exitCode: code || 0
        });
      });

      runProcess.on('error', (err) => {
        reject(err);
      });

      if (input) {
        runProcess.stdin.write(input);
        runProcess.stdin.end();
      }
    });

    compileProcess.on('error', (err) => {
      reject(err);
    });
  });
};

const executeTypeScript = async (filePath: string, input: string): Promise<{
  output: string;
  error: string;
  exitCode: number;
}> => {
  console.log('Executing TypeScript file:', filePath);
  // First try: ts-node (direct TypeScript execution)
  try {
    console.log('Trying ts-node approach...');
    return await executeWithTsNode(filePath, input);
  } catch (tsNodeError) {
    console.log('ts-node failed, trying compilation approach:', tsNodeError);
    // Fallback: compile and run
    return await compileAndRunTypeScript(filePath, input);
  }
};

const executeWithTsNode = (filePath: string, input: string): Promise<{
  output: string;
  error: string;
  exitCode: number;
}> => {
  return new Promise((resolve, reject) => {
    console.log('Attempting ts-node execution for:', filePath);
    // Try different ts-node approaches
    let process;
    
    try {
      // First try: npx ts-node (most reliable approach)
      console.log('Trying npx ts-node...');
      process = spawn('npx', ['ts-node', filePath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10000,
      });
    } catch (npxError) {
      console.log('npx ts-node failed, trying direct ts-node...', npxError);
      try {
        // Second try: direct ts-node
        process = spawn('ts-node', [filePath], {
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 10000,
        });
      } catch (error) {
        console.log('Direct ts-node also failed:', error);
        reject(new Error('ts-node not available'));
        return;
      }
    }

    let output = '';
    let error = '';

    process.stdout.on('data', (data) => {
      output += data.toString();
    });

    process.stderr.on('data', (data) => {
      error += data.toString();
    });

    process.on('close', (code) => {
      resolve({
        output: output.trim(),
        error: error.trim(),
        exitCode: code || 0
      });
    });

    process.on('error', (err) => {
      reject(err);
    });

    if (input) {
      process.stdin.write(input);
      process.stdin.end();
    }
  });
};

const compileAndRunTypeScript = (filePath: string, input: string): Promise<{
  output: string;
  error: string;
  exitCode: number;
}> => {
  return new Promise((resolve, reject) => {
    const jsFilePath = filePath.replace('.ts', '.js');
    
    // Try different TypeScript compiler approaches
    let compileProcess;
    
    // First try: npx tsc with full path (most reliable approach)
    try {
      const npmPath = 'C:\\Program Files\\nodejs\\npm.cmd';
      compileProcess = spawn(npmPath, ['exec', 'tsc', filePath, '--outDir', path.dirname(filePath), '--target', 'ES2020', '--module', 'commonjs'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5000,
      });
    } catch (npxError) {
      // Second try: direct tsc command (if available globally)
      try {
        compileProcess = spawn('tsc', [filePath, '--outDir', path.dirname(filePath), '--target', 'ES2020', '--module', 'commonjs'], {
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 5000,
        });
      } catch (error) {
        // Third try: PowerShell with common TypeScript paths (Windows)
        const commonTscPaths = [
          'C:\\Users\\Lenovo\\AppData\\Roaming\\npm\\tsc.ps1',
          'C:\\Program Files\\nodejs\\node_modules\\typescript\\bin\\tsc',
          'C:\\Users\\Lenovo\\AppData\\Roaming\\npm\\node_modules\\typescript\\bin\\tsc'
        ];
        
        let tscFound = false;
        for (const tscPath of commonTscPaths) {
          try {
            if (fs.existsSync(tscPath)) {
              compileProcess = spawn('powershell', ['-Command', `& "${tscPath}" "${filePath}" --outDir "${path.dirname(filePath)}" --target ES2020 --module commonjs`], {
                stdio: ['pipe', 'pipe', 'pipe'],
                timeout: 5000,
              });
              tscFound = true;
              break;
            }
          } catch (pathError) {
            continue;
          }
        }
        
        if (!tscFound) {
          reject(new Error('TypeScript compiler not found. Please install TypeScript globally: npm install -g typescript'));
          return;
        }
      }
    }

    let compileError = '';
    let compileOutput = '';

    if (!compileProcess) {
      reject(new Error('Failed to start TypeScript compilation process.'));
      return;
    }

    compileProcess.stderr.on('data', (data) => {
      compileError += data.toString();
    });

    compileProcess.stdout.on('data', (data) => {
      compileOutput += data.toString();
    });

    compileProcess.on('close', (compileCode) => {
      if (compileCode !== 0) {
        const errorMessage = compileError || compileOutput || 'Unknown compilation error';
        resolve({
          output: '',
          error: `TypeScript compilation error: ${errorMessage}`,
          exitCode: compileCode ?? 0
        });
        return;
      }

      // Then run
      const runProcess = spawn('node', [jsFilePath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10000,
      });

      let output = '';
      let error = '';

      runProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      runProcess.stderr.on('data', (data) => {
        error += data.toString();
      });

      runProcess.on('close', (code) => {
        // Clean up JS file
        try {
          fs.unlinkSync(jsFilePath);
        } catch (cleanupError) {
          console.warn('Failed to cleanup JS file:', cleanupError);
        }

        resolve({
          output: output.trim(),
          error: error.trim(),
          exitCode: code || 0
        });
      });

      runProcess.on('error', (err) => {
        reject(err);
      });

      if (input) {
        runProcess.stdin.write(input);
        runProcess.stdin.end();
      }
    });

    compileProcess.on('error', (err) => {
      reject(err);
    });
  });
};

const getFileExtension = (language: string): string => {
  const extensions: { [key: string]: string } = {
    python: 'py',
    java: 'java',
    cpp: 'cpp',
    csharp: 'cs',
    javascript: 'js',
    typescript: 'ts'
  };
  return extensions[language] || 'txt';
};
