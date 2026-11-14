const { execFile } = require('node:child_process');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const backendRoot = path.resolve(__dirname, '../..');
const pipelinePath = path.join(backendRoot, 'recommender', 'run_pipeline.py');

async function updateContentBasedRecommendations(userId) {
  const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  await execFileAsync(
    python,
    [pipelinePath, '--refresh-user', String(userId)],
    {
      cwd: backendRoot,
      timeout: 120000,
      windowsHide: true,
    }
  );
}

module.exports = { updateContentBasedRecommendations };
