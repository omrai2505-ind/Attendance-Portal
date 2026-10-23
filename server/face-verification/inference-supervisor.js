const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const DEFAULT_BASE_URL = process.env.FACE_SERVICE_URL || 'http://127.0.0.1:8001';
const HEALTH_ENDPOINT = `${DEFAULT_BASE_URL}/health`;

let childProcess = null;
let startingPromise = null;
let restartAttempts = 0;
const MAX_RESTART_ATTEMPTS = 5;

/**
 * Check if the Python FastAPI inference service is responding and ready.
 */
async function isServiceHealthy(baseUrl = DEFAULT_BASE_URL) {
  try {
    const res = await fetch(`${baseUrl}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(1200)
    });
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data && data.ready);
  } catch (_err) {
    return false;
  }
}

/**
 * Locate Python executable, preferring project virtualenv in inference/.venv.
 */
function findPythonExecutable() {
  const inferenceDir = path.resolve(__dirname, '../../inference');

  // Candidate paths
  const candidates = [
    process.env.PYTHON_PATH,
    path.join(inferenceDir, '.venv', 'Scripts', 'python.exe'), // Windows venv
    path.join(inferenceDir, '.venv', 'bin', 'python'),          // Linux/macOS venv
    path.join(__dirname, '../../../inference/.venv/Scripts/python.exe'),
    path.join(__dirname, '../../../inference/.venv/bin/python'),
    'python',
    'python3',
    'py'
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (path.isAbsolute(candidate)) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } else {
      // Relative or system command
      return candidate;
    }
  }

  return 'python';
}

/**
 * Terminate the managed child process cleanly.
 */
function killManagedProcess() {
  if (childProcess && !childProcess.killed) {
    console.log('[FaceSupervisor] Stopping Python inference process (PID:', childProcess.pid, ')...');
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', childProcess.pid.toString(), '/f', '/t'], { stdio: 'ignore' });
      } else {
        childProcess.kill('SIGTERM');
      }
    } catch (_) {}
    childProcess = null;
  }
}

// Hook process termination to prevent orphan processes
process.once('exit', killManagedProcess);
process.once('SIGINT', killManagedProcess);
process.once('SIGTERM', killManagedProcess);

/**
 * Ensure the inference service is actively running and ready to handle requests.
 * If not already running, auto-spawns it and polls /health until ready.
 */
async function ensureRunning() {
  // If already healthy, nothing to do
  if (await isServiceHealthy()) {
    return true;
  }

  // If a boot is already underway, wait for it
  if (startingPromise) {
    return startingPromise;
  }

  startingPromise = (async () => {
    try {
      const inferenceDir = path.resolve(__dirname, '../../inference');
      const pythonExe = findPythonExecutable();

      console.log(`\n🤖 [FaceSupervisor] Face inference service is offline. Auto-starting...`);
      console.log(`   Python executable: ${pythonExe}`);
      console.log(`   Working directory: ${inferenceDir}\n`);

      const child = spawn(
        pythonExe,
        ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8001'],
        {
          cwd: inferenceDir,
          env: {
            ...process.env,
            PYTHONUNBUFFERED: '1'
          },
          stdio: ['ignore', 'pipe', 'pipe']
        }
      );

      childProcess = child;

      child.stdout.on('data', (chunk) => {
        const text = chunk.toString().trim();
        if (text) {
          // Output to console with clear prefix
          text.split('\n').forEach((line) => {
            if (line.includes('ERROR') || line.includes('loaded') || line.includes('Uvicorn running')) {
              console.log(`[FaceInference] ${line.trim()}`);
            }
          });
        }
      });

      child.stderr.on('data', (chunk) => {
        const text = chunk.toString().trim();
        if (text) {
          text.split('\n').forEach((line) => {
            console.log(`[FaceInference] ${line.trim()}`);
          });
        }
      });

      child.on('error', (err) => {
        console.error(`[FaceSupervisor] Process spawn error:`, err.message);
      });

      child.on('exit', (code, signal) => {
        console.warn(`[FaceSupervisor] Process exited (code: ${code}, signal: ${signal})`);
        childProcess = null;

        // Auto-restart if unexpected exit and under limit
        if (code !== 0 && restartAttempts < MAX_RESTART_ATTEMPTS) {
          restartAttempts += 1;
          console.log(`[FaceSupervisor] Auto-restarting inference service (attempt ${restartAttempts}/${MAX_RESTART_ATTEMPTS})...`);
          setTimeout(() => {
            ensureRunning().catch(() => {});
          }, 2000);
        }
      });

      // Poll /health for up to 10 seconds
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        if (await isServiceHealthy()) {
          console.log(`✅ [FaceSupervisor] Face inference service is ONLINE and ready at http://127.0.0.1:8001\n`);
          restartAttempts = 0;
          return true;
        }
      }

      console.warn(`⚠️ [FaceSupervisor] Timed out waiting for face inference service to respond.`);
      return false;
    } catch (err) {
      console.error(`❌ [FaceSupervisor] Failed to auto-start face inference service:`, err.message);
      return false;
    } finally {
      startingPromise = null;
    }
  })();

  return startingPromise;
}

module.exports = {
  isServiceHealthy,
  ensureRunning,
  killManagedProcess
};
