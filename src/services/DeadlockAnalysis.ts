export interface DeadlockTypeInfo {
  type: string;
  name: string;
  description: string;
  scenario: string;
  impactOnProductivity: string;
  preventionInEngine: string;
}

export interface DeadlockReport {
  title: string;
  summary: string;
  deadlockTypes: DeadlockTypeInfo[];
  productivityImpactSummary: string[];
  architecturalGuarantees: string[];
}

export class DeadlockAnalysisService {
  public static getReport(): DeadlockReport {
    return {
      title: "Deadlock Prevention & Concurrency Architecture Analysis",
      summary: "In a multi-user, multi-file server queueing system, concurrent file parsing, thread resource contention, and priority inversion can lead to severe system-wide stalls. This engine implements deterministic lock-free scheduling, thread isolation, and dynamic priority aging to eliminate all possible deadlocks.",
      deadlockTypes: [
        {
          type: "RESOURCE_STARVATION_INVERSION",
          name: "Priority Inversion & Starvation Deadlock",
          description: "When high-priority tasks continuously arrive, low-priority tasks wait indefinitely in the queue and never get scheduled, effectively freezing client progress.",
          scenario: "User A continuously sends 100 HIGH-priority files. User B's LOW-priority files stay at the back of the queue indefinitely.",
          impactOnProductivity: "User B experiences infinite latency, workflow blockers, and apparent system freezes without receiving error feedback.",
          preventionInEngine: "Dynamic Aging Algorithm: Low-priority jobs accrue priority points every 1.5 seconds in the queue. As wait time increases, their effective score surpasses incoming high-priority jobs, guaranteeing a bounded maximum latency (Starvation Freedom)."
        },
        {
          type: "THREAD_POOL_EXHAUSTION",
          name: "Thread Pool Exhaustion / Blocking Deadlock",
          description: "If worker threads become blocked waiting for I/O or nested task dependencies, all threads in the pool lock up simultaneously, halting all subsequent jobs.",
          scenario: "A worker thread synchronously reads a massive 2GB CSV file into memory all at once or waits synchronously for a child process.",
          impactOnProductivity: "All users across the system are blocked; zero throughput; server CPU/memory spikes leading to hard crashes.",
          preventionInEngine: "Streaming Chunks & Pre-Allocated Worker Pools: Worker threads use asynchronous non-blocking stream parsers (line-by-line / chunked). Workers never allocate or wait on downstream locks. If a worker fails, the supervisor automatically respawns it."
        },
        {
          type: "CIRCULAR_WAIT",
          name: "Circular Wait & Shared State Deadlock",
          description: "Occurs when multiple tasks or threads compete for shared mutable resources (like in-memory queue state or file locks) in opposing lock orders.",
          scenario: "Thread 1 holds File A and requests File B; Thread 2 holds File B and requests File A.",
          impactOnProductivity: "Both tasks hang forever until server timeout or restart, corrupting state and wasting computational resources.",
          preventionInEngine: "Shared-Nothing Single-Writer Architecture: Node.js main thread operates as the sole state orchestrator via single-threaded event loop message passing. Workers share no memory or locks; communication occurs strictly over isolated `MessagePort` channels."
        },
        {
          type: "HEAD_OF_LINE_BLOCKING",
          name: "Head-of-Line (HoL) Pipeline Blocking",
          description: "A single extremely slow or malformed file at the front of a single queue blocks all subsequent lightweight files from all other users.",
          scenario: "User 1 submits a 500,000-row file; Users 2, 3, 4 with 10-row files cannot start until User 1 completely finishes.",
          impactOnProductivity: "High variance in turnaround time; small quick tasks suffer catastrophic slowdowns.",
          preventionInEngine: "Multi-Worker Parallelism with Bounded Dispatch: The scheduler distributes jobs across all CPU worker threads concurrently. Real-time chunked reduction ensures CPU cores process tasks concurrently without head-of-line bottlenecks."
        }
      ],
      productivityImpactSummary: [
        "Infinite Wait Times: Users perceive the system as crashed or unresponsive.",
        "Unpredictable Latency: SLA breaches due to priority starvation for standard-tier users.",
        "Resource Waste: Idle CPU/Memory locked in unresolvable wait states instead of computing all-reduce sums.",
        "Cascading Failures: Client retries amplify the queue backlog, exacerbating the deadlock."
      ],
      architecturalGuarantees: [
        "100% Lock-Free State Management (OOP Message Passing)",
        "Dynamic Priority Aging (Zero Starvation Guarantee)",
        "Fault-Tolerant Worker Pool Isolation with Auto-Recovery",
        "Stream-Based Memory Efficiency (Rank Agnostic O(1) Memory Footprint)"
      ]
    };
  }
}
