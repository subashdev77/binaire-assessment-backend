import { Job, JobJSON, JobPriority, JobRank } from '../models/Job.js';
import { PriorityQueue } from './PriorityQueue.js';
import { WorkerPool } from './WorkerPool.js';
import { Broadcaster } from './Broadcaster.js';

export interface SystemSnapshot {
  queue: JobJSON[];
  active: JobJSON[];
  completed: JobJSON[];
  workers: any[];
  metrics: {
    totalProcessed: number;
    totalFailed: number;
    connectedClients: number;
    queueLength: number;
    activeWorkers: number;
    totalWorkers: number;
    cpuCount: number;
    uptimeSeconds: number;
  };
}

/**
 * QueueManager: Central Object-Oriented Orchestrator for scheduling,
 * multi-user dispatching, deadlock mitigation, and real-time synchronization.
 */
export class QueueManager {
  private queue: PriorityQueue;
  private workerPool: WorkerPool;
  private broadcaster: Broadcaster;
  
  private allJobs: Map<string, Job> = new Map();
  private activeJobs: Map<string, Job> = new Map();
  private completedJobs: Job[] = [];
  
  private totalProcessedCount: number = 0;
  private totalFailedCount: number = 0;
  private startTime: number = Date.now();
  private agingTimer: NodeJS.Timeout | null = null;
  private scheduleTimer: NodeJS.Timeout | null = null;

  constructor(broadcaster: Broadcaster, poolSize?: number) {
    this.broadcaster = broadcaster;
    this.queue = new PriorityQueue(1500, 30); // Dynamic aging every 1.5s (+30 pts)

    this.workerPool = new WorkerPool(poolSize, {
      onProgress: (jobId: string, progress: number) => this.handleJobProgress(jobId, progress),
      onComplete: (jobId: string, resultSum: number, totalNumbers: number, rank: JobRank) => 
        this.handleJobComplete(jobId, resultSum, totalNumbers, rank),
      onError: (jobId: string, error: string) => this.handleJobError(jobId, error)
    });

    this.startSchedulingLoops();
  }

  private startSchedulingLoops(): void {
    // Continuous dynamic aging loop (prevents starvation deadlocks)
    this.agingTimer = setInterval(() => {
      const aged = this.queue.applyAging();
      if (aged) {
        this.broadcastSnapshot();
      }
    }, 1500);

    // Continuous dispatch ticker
    this.scheduleTimer = setInterval(() => {
      this.processNextInQueue();
    }, 100);
  }

  /**
   * Accepts and enqueues a new file job from any user.
   */
  public addJob(
    userId: string,
    originalFilename: string,
    storedFilename: string,
    filePath: string,
    fileSize: number,
    priority: JobPriority
  ): Job {
    const job = new Job(userId, originalFilename, storedFilename, filePath, fileSize, priority);
    this.allJobs.set(job.id, job);

    // Add to priority queue
    this.queue.enqueue(job);

    this.broadcaster.broadcast('JOB_STATUS_CHANGED', job.toJSON());
    this.broadcastSnapshot();

    // Trigger immediate scheduling attempt
    this.processNextInQueue();

    return job;
  }

  /**
   * Schedules the next job if workers are available.
   */
  public processNextInQueue(): void {
    while (this.workerPool.hasAvailableWorker() && !this.queue.isEmpty()) {
      const job = this.queue.dequeue();
      if (!job) break;

      // Mark waiting / preparing
      job.markWaiting();
      this.broadcaster.broadcast('JOB_STATUS_CHANGED', job.toJSON());

      const workerId = this.workerPool.dispatch(job);
      if (workerId !== null) {
        job.markProcessing(workerId, process.pid);
        this.activeJobs.set(job.id, job);
        this.broadcaster.broadcast('JOB_STATUS_CHANGED', job.toJSON());
      } else {
        // If worker dispatch failed unexpectedly, re-insert at top of queue
        this.queue.enqueue(job);
        break;
      }
    }
  }

  private handleJobProgress(jobId: string, progress: number): void {
    const job = this.activeJobs.get(jobId);
    if (job) {
      job.updateProgress(progress);
      this.broadcaster.broadcast('JOB_PROGRESS', {
        id: job.id,
        progress: job.progress,
        workerId: job.workerId
      });
    }
  }

  private handleJobComplete(jobId: string, resultSum: number, totalNumbers: number, rank: JobRank): void {
    const job = this.activeJobs.get(jobId);
    if (job) {
      job.markCompleted(resultSum, totalNumbers, rank);
      this.activeJobs.delete(jobId);
      this.completedJobs.unshift(job);
      if (this.completedJobs.length > 100) {
        this.completedJobs.pop(); // keep last 100
      }
      this.totalProcessedCount++;

      this.broadcaster.broadcast('JOB_COMPLETED', job.toJSON());
      this.broadcastSnapshot();
      this.processNextInQueue();
    }
  }

  private handleJobError(jobId: string, error: string): void {
    const job = this.activeJobs.get(jobId);
    if (job) {
      job.markFailed(error);
      this.activeJobs.delete(jobId);
      this.completedJobs.unshift(job);
      this.totalFailedCount++;

      this.broadcaster.broadcast('JOB_FAILED', job.toJSON());
      this.broadcastSnapshot();
      this.processNextInQueue();
    }
  }

  public getJob(id: string): Job | undefined {
    return this.allJobs.get(id);
  }

  public getSnapshot(): SystemSnapshot {
    const queuedItems = this.queue.getItems().map(j => j.toJSON());
    const activeItems = Array.from(this.activeJobs.values()).map(j => j.toJSON());
    const completedItems = this.completedJobs.map(j => j.toJSON());
    const workerStates = this.workerPool.getWorkerStates();

    return {
      queue: queuedItems,
      active: activeItems,
      completed: completedItems,
      workers: workerStates,
      metrics: {
        totalProcessed: this.totalProcessedCount,
        totalFailed: this.totalFailedCount,
        connectedClients: this.broadcaster.getConnectedClientCount(),
        queueLength: queuedItems.length,
        activeWorkers: workerStates.filter(w => w.status === 'BUSY').length,
        totalWorkers: workerStates.length,
        cpuCount: this.workerPool.getPoolSize(),
        uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000)
      }
    };
  }

  public broadcastSnapshot(): void {
    this.broadcaster.broadcast('QUEUE_SNAPSHOT', this.getSnapshot());
  }

  public clearCompleted(): void {
    this.completedJobs = [];
    this.broadcastSnapshot();
  }

  public destroy(): void {
    if (this.agingTimer) clearInterval(this.agingTimer);
    if (this.scheduleTimer) clearInterval(this.scheduleTimer);
    this.workerPool.destroy();
  }
}
