import { v4 as uuidv4 } from 'uuid';

export type JobPriority = 'HIGH' | 'LOW';

export type JobStatus =
  | 'UPLOADING'
  | 'UPLOADED'
  | 'QUEUED'
  | 'WAITING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED';

export interface JobRank {
  rows: number;
  cols: number;
}

export interface JobJSON {
  id: string;
  userId: string;
  originalFilename: string;
  fileSize: number;
  rank: JobRank | null;
  priority: JobPriority;
  effectivePriorityScore: number;
  status: JobStatus;
  progress: number;
  workerId: number | null;
  processId: number | null;
  resultSum: number | null;
  totalNumbersCount: number | null;
  error: string | null;
  createdAt: number;
  queuedAt: number | null;
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
}

export class Job {
  public readonly id: string;
  public readonly userId: string;
  public readonly originalFilename: string;
  public readonly storedFilename: string;
  public readonly filePath: string;
  public readonly fileSize: number;
  public rank: JobRank | null = null;
  public readonly priority: JobPriority;
  public effectivePriorityScore: number;
  public status: JobStatus;
  public progress: number = 0;
  public workerId: number | null = null;
  public processId: number | null = null;
  public resultSum: number | null = null;
  public totalNumbersCount: number | null = null;
  public error: string | null = null;
  public readonly createdAt: number;
  public queuedAt: number | null = null;
  public startedAt: number | null = null;
  public completedAt: number | null = null;

  constructor(
    userId: string,
    originalFilename: string,
    storedFilename: string,
    filePath: string,
    fileSize: number,
    priority: JobPriority = 'LOW'
  ) {
    this.id = uuidv4();
    this.userId = userId;
    this.originalFilename = originalFilename;
    this.storedFilename = storedFilename;
    this.filePath = filePath;
    this.fileSize = fileSize;
    this.priority = priority;

    this.effectivePriorityScore = priority === 'HIGH' ? 1000 : 100;
    this.status = 'UPLOADED';
    this.createdAt = Date.now();
    this.processId = process.pid;
  }

  public markQueued(): void {
    this.status = 'QUEUED';
    this.queuedAt = Date.now();
  }

  public markWaiting(workerId?: number): void {
    this.status = 'WAITING';
    if (workerId !== undefined) {
      this.workerId = workerId;
    }
  }

  public markProcessing(workerId: number, processId: number): void {
    this.status = 'PROCESSING';
    this.workerId = workerId;
    this.processId = processId;
    this.startedAt = Date.now();
    this.progress = 0;
  }

  public updateProgress(progress: number): void {
    this.progress = Math.min(100, Math.max(0, Math.round(progress)));
  }

  public markCompleted(resultSum: number, totalNumbersCount: number, rank?: JobRank): void {
    this.status = 'COMPLETED';
    this.progress = 100;
    this.resultSum = resultSum;
    this.totalNumbersCount = totalNumbersCount;
    if (rank) {
      this.rank = rank;
    }
    this.completedAt = Date.now();
  }

  public markFailed(errorMessage: string): void {
    this.status = 'FAILED';
    this.error = errorMessage;
    this.completedAt = Date.now();
  }

  public age(increment: number = 10): void {
    if (this.priority === 'LOW' && this.status === 'QUEUED') {
      this.effectivePriorityScore += increment;
    }
  }

  public toJSON(): JobJSON {
    return {
      id: this.id,
      userId: this.userId,
      originalFilename: this.originalFilename,
      fileSize: this.fileSize,
      rank: this.rank,
      priority: this.priority,
      effectivePriorityScore: this.effectivePriorityScore,
      status: this.status,
      progress: this.progress,
      workerId: this.workerId,
      processId: this.processId,
      resultSum: this.resultSum,
      totalNumbersCount: this.totalNumbersCount,
      error: this.error,
      createdAt: this.createdAt,
      queuedAt: this.queuedAt,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      durationMs: this.startedAt && this.completedAt ? this.completedAt - this.startedAt : null
    };
  }
}
