import { Job } from '../models/Job.js';

export interface QueueMetrics {
  totalQueued: number;
  highPriorityCount: number;
  lowPriorityCount: number;
  averageWaitTimeMs: number;
}

/**
 * PriorityQueue implementation using Object-Oriented principles.
 * Incorporates Dynamic Aging to eliminate starvation and priority inversion deadlocks.
 */
export class PriorityQueue {
  private items: Job[] = [];
  private agingIntervalMs: number;
  private agingPoints: number;

  constructor(agingIntervalMs: number = 2000, agingPoints: number = 25) {
    this.agingIntervalMs = agingIntervalMs;
    this.agingPoints = agingPoints;
  }

  /**
   * Enqueue a job according to effective priority score.
   * Higher score = processed sooner.
   * If scores are identical, FIFO (order of arrival) is preserved.
   */
  public enqueue(job: Job): void {
    job.markQueued();
    let added = false;

    for (let i = 0; i < this.items.length; i++) {
      if (job.effectivePriorityScore > this.items[i].effectivePriorityScore) {
        this.items.splice(i, 0, job);
        added = true;
        break;
      }
    }

    if (!added) {
      this.items.push(job);
    }
  }

  /**
   * Dequeues the highest priority job from the queue.
   */
  public dequeue(): Job | undefined {
    return this.items.shift();
  }

  /**
   * Peek at the next job to be scheduled without removing it.
   */
  public peek(): Job | undefined {
    return this.items[0];
  }

  /**
   * Remove a job by ID (e.g. cancellation).
   */
  public remove(jobId: string): Job | null {
    const index = this.items.findIndex(item => item.id === jobId);
    if (index !== -1) {
      const [removed] = this.items.splice(index, 1);
      return removed;
    }
    return null;
  }

  /**
   * Starvation & Deadlock Prevention:
   * Periodically ages waiting jobs. If low-priority jobs wait too long,
   * their effective priority score increases, eventually surpassing higher-priority incoming jobs.
   */
  public applyAging(): boolean {
    if (this.items.length === 0) return false;
    let scoreChanged = false;

    for (const job of this.items) {
      if (job.priority === 'LOW') {
        const oldScore = job.effectivePriorityScore;
        job.age(this.agingPoints);
        if (job.effectivePriorityScore !== oldScore) {
          scoreChanged = true;
        }
      }
    }

    if (scoreChanged) {
      // Re-sort based on new effective scores, maintaining stability
      this.items.sort((a, b) => {
        if (b.effectivePriorityScore !== a.effectivePriorityScore) {
          return b.effectivePriorityScore - a.effectivePriorityScore;
        }
        return (a.queuedAt || 0) - (b.queuedAt || 0);
      });
    }

    return scoreChanged;
  }

  public getItems(): Job[] {
    return [...this.items];
  }

  public size(): number {
    return this.items.length;
  }

  public isEmpty(): boolean {
    return this.items.length === 0;
  }

  public getMetrics(): QueueMetrics {
    const now = Date.now();
    let totalWait = 0;
    let high = 0;
    let low = 0;

    for (const job of this.items) {
      if (job.priority === 'HIGH') high++;
      else low++;
      if (job.queuedAt) {
        totalWait += (now - job.queuedAt);
      }
    }

    return {
      totalQueued: this.items.length,
      highPriorityCount: high,
      lowPriorityCount: low,
      averageWaitTimeMs: this.items.length > 0 ? Math.round(totalWait / this.items.length) : 0
    };
  }
}
