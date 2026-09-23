import { parentPort } from 'worker_threads';
import fs from 'fs';
import readline from 'readline';

if (!parentPort) {
  throw new Error('This module must run as a Worker Thread');
}

const port = parentPort;

interface WorkerTaskData {
  jobId: string;
  filePath: string;
  fileSize: number;
}

async function processCsv(task: WorkerTaskData): Promise<void> {
  const { jobId, filePath, fileSize } = task;

  if (!fs.existsSync(filePath)) {
    port.postMessage({
      type: 'ERROR',
      jobId,
      error: `File not found: ${filePath}`
    });
    return;
  }

  let totalSum = 0;
  let totalNumbers = 0;
  let rowCount = 0;
  let detectedCols = 0;
  let bytesRead = 0;
  let lastReportedProgress = 0;

  const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const sendProgress = (pct: number) => {
    const clamped = Math.min(99, Math.max(1, Math.round(pct)));
    if (clamped !== lastReportedProgress) {
      lastReportedProgress = clamped;
      port.postMessage({
        type: 'PROGRESS',
        jobId,
        progress: clamped
      });
    }
  };

  sendProgress(5);

  try {
    for await (const line of rl) {
      const lineTrimmed = line.trim();
      bytesRead += Buffer.byteLength(line, 'utf-8') + 1;

      if (lineTrimmed.length === 0) continue;

      rowCount++;
      const cells = lineTrimmed.split(/[,;\t]/);
      if (cells.length > detectedCols) {
        detectedCols = cells.length;
      }

      for (const rawCell of cells) {
        const cell = rawCell.trim();
        if (cell.length === 0) continue;

        const num = Number(cell);
        if (!isNaN(num) && isFinite(num)) {
          totalSum += num;
          totalNumbers++;
        }
      }

      if (fileSize > 0 && rowCount % 50 === 0) {
        const estProgress = (bytesRead / fileSize) * 100;
        sendProgress(estProgress);
      }
    }

    sendProgress(100);

    const roundedSum = Number(totalSum.toFixed(8));

    port.postMessage({
      type: 'DONE',
      jobId,
      resultSum: roundedSum,
      totalNumbersCount: totalNumbers,
      rank: {
        rows: rowCount,
        cols: detectedCols
      }
    });
  } catch (err: any) {
    port.postMessage({
      type: 'ERROR',
      jobId,
      error: err?.message || 'Failed to process CSV file'
    });
  }
}

port.on('message', (task: WorkerTaskData) => {
  processCsv(task);
});
