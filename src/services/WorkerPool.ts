import { Worker } from 'worker_threads';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { Job, JobRank } from '../models/Job.js';

export type WorkerState = 'IDLE' | 'BUSY' | 'INITIALIZING';

export interface WorkerInfo {
  id: number;
  threadId: number;
  processId: number;
  status: WorkerState;
  currentJobId: string | null;
  tasksCompleted: number;
  lastActive: number;
}

export interface WorkerPoolCallbacks {
  onProgress: (jobId: string, progress: number) => void;
  onComplete: (jobId: string, resultSum: number, totalNumbers: number, rank: JobRank) => void;
  onError: (jobId: string, error: string) => void;
}

export class WorkerPool {
  private poolSize: number;
  private workers: Map<number, { worker: Worker; info: WorkerInfo }> = new Map();
  private callbacks: WorkerPoolCallbacks;
  private workerScriptPath: string;

  constructor(poolSize: number = Math.max(2, Math.min(8, os.cpus().length)), callbacks: WorkerPoolCallbacks) {
    this.poolSize = poolSize;
    this.callbacks = callbacks;

    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const isTs = process.argv.some(arg => arg.endsWith('.ts')) || process.execArgv.some(arg => arg.includes('tsx') || arg.includes('ts-node'));

    if (isTs) {
      this.workerScriptPath = path.resolve(currentDir, '../workers/csvWorker.ts');
    } else {
      this.workerScriptPath = path.resolve(currentDir, '../workers/csvWorker.js');
    }

    this.initializePool();
  }

  private initializePool(): void {
    for (let i = 1; i <= this.poolSize; i++) {
      this.spawnWorker(i);
    }
  }

  private spawnWorker(id: number): void {
    const isTs = this.workerScriptPath.endsWith('.ts');

    const worker = new Worker(this.workerScriptPath, {
      execArgv: isTs ? ['--import', 'tsx'] : []
    });

    const info: WorkerInfo = {
      id,
      threadId: worker.threadId,
      processId: process.pid,
      status: 'IDLE',
      currentJobId: null,
      tasksCompleted: 0,
      lastActive: Date.now()
    };

    worker.on('message', (msg: any) => {
      this.handleWorkerMessage(id, msg);
    });

    worker.on('error', (err: Error) => {
      console.error(`Worker #${id} encountered error:`, err);
      const currentJobId = this.workers.get(id)?.info.currentJobId;
      if (currentJobId) {
        this.callbacks.onError(currentJobId, `Worker error: ${err.message}`);
      }
      this.restartWorker(id);
    });

    worker.on('exit', (code: number) => {
      if (code !== 0) {
        console.warn(`Worker #${id} exited with code ${code}. Respawning to prevent thread starvation...`);
        this.restartWorker(id);
      }
    });

    this.workers.set(id, { worker, info });
  }

  private restartWorker(id: number): void {
    const existing = this.workers.get(id);
    if (existing) {
      try {
        existing.worker.terminate();
      } catch (e) {}
    }
    this.spawnWorker(id);
  }

  private handleWorkerMessage(workerId: number, msg: any): void {
    const entry = this.workers.get(workerId);
    if (!entry) return;

    if (msg.type === 'PROGRESS') {
      this.callbacks.onProgress(msg.jobId, msg.progress);
    } else if (msg.type === 'DONE') {
      entry.info.status = 'IDLE';
      entry.info.currentJobId = null;
      entry.info.tasksCompleted++;
      entry.info.lastActive = Date.now();
      this.callbacks.onComplete(msg.jobId, msg.resultSum, msg.totalNumbersCount, msg.rank);
    } else if (msg.type === 'ERROR') {
      entry.info.status = 'IDLE';
      entry.info.currentJobId = null;
      entry.info.lastActive = Date.now();
      this.callbacks.onError(msg.jobId, msg.error);
    }
  }

  public dispatch(job: Job): number | null {
    for (const [id, entry] of this.workers.entries()) {
      if (entry.info.status === 'IDLE') {
        entry.info.status = 'BUSY';
        entry.info.currentJobId = job.id;
        entry.info.lastActive = Date.now();
        entry.info.threadId = entry.worker.threadId;

        entry.worker.postMessage({
          jobId: job.id,
          filePath: job.filePath,
          fileSize: job.fileSize
        });

        return id;
      }
    }
    return null;
  }

  public hasAvailableWorker(): boolean {
    for (const entry of this.workers.values()) {
      if (entry.info.status === 'IDLE') return true;
    }
    return false;
  }

  public getWorkerStates(): WorkerInfo[] {
    return Array.from(this.workers.values()).map(e => ({ ...e.info }));
  }

  public getPoolSize(): number {
    return this.poolSize;
  }

  public destroy(): void {
    for (const entry of this.workers.values()) {
      entry.worker.terminate();
    }
    this.workers.clear();
  }
}
