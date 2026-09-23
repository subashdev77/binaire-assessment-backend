import express, { Request, Response } from 'express';
import http from 'http';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { Broadcaster } from './services/Broadcaster.js';
import { QueueManager } from './services/QueueManager.js';
import { DeadlockAnalysisService } from './services/DeadlockAnalysis.js';
import { JobPriority } from './models/Job.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5001;

const UPLOADS_DIR = path.resolve(__dirname, '../uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname) || '.csv';
    cb(null, `${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }
});

app.use(cors({ origin: '*' }));
app.use(express.json());

const broadcaster = new Broadcaster();
broadcaster.attach(server);

const queueManager = new QueueManager(broadcaster);

app.get('/', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'binaire-assessment-backend',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

app.get('/api/queue', (_req: Request, res: Response) => {
  res.json(queueManager.getSnapshot());
});

app.post('/api/upload', upload.array('files', 20), (req: Request, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files were uploaded.' });
    }

    const userId = (req.body.userId as string) || `User-${Math.floor(Math.random() * 1000)}`;
    const rawPriority = (req.body.priority as string)?.toUpperCase();
    const priority: JobPriority = rawPriority === 'HIGH' ? 'HIGH' : 'LOW';

    const createdJobs = files.map(file => {
      return queueManager.addJob(
        userId,
        file.originalname,
        file.filename,
        file.path,
        file.size,
        priority
      ).toJSON();
    });

    return res.status(201).json({
      message: `Enqueued ${createdJobs.length} file(s) successfully`,
      jobs: createdJobs
    });
  } catch (err: any) {
    console.error('Upload error:', err);
    return res.status(500).json({ error: err.message || 'Failed to process upload' });
  }
});

app.get('/api/jobs/:id', (req: Request, res: Response) => {
  const job = queueManager.getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(job.toJSON());
});

app.get('/api/jobs/:id/download', (req: Request, res: Response) => {
  const job = queueManager.getJob(req.params.id);
  if (!job || !fs.existsSync(job.filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.download(job.filePath, job.originalFilename);
});

app.post('/api/clear-completed', (_req: Request, res: Response) => {
  queueManager.clearCompleted();
  res.json({ message: 'Completed jobs cleared' });
});

app.get('/api/deadlock-analysis', (_req: Request, res: Response) => {
  res.json(DeadlockAnalysisService.getReport());
});

app.post('/api/generate-csv', (req: Request, res: Response) => {
  try {
    const rows = Math.min(100000, Math.max(5, parseInt(req.body.rows) || 100));
    const cols = Math.min(100, Math.max(2, parseInt(req.body.cols) || 5));
    const filename = `generated_${rows}x${cols}_${Date.now()}.csv`;
    const targetPath = path.join(UPLOADS_DIR, filename);

    const writeStream = fs.createWriteStream(targetPath);
    let calculatedSum = 0;

    for (let r = 0; r < rows; r++) {
      const rowVals: string[] = [];
      for (let c = 0; c < cols; c++) {

        const val = Math.random() > 0.5
          ? Math.floor(Math.random() * 100) - 20
          : Number((Math.random() * 50 - 10).toFixed(2));
        calculatedSum += val;
        rowVals.push(val.toString());
      }
      writeStream.write(rowVals.join(',') + '\n');
    }

    writeStream.end(() => {
      const stats = fs.statSync(targetPath);
      res.json({
        filename,
        path: targetPath,
        size: stats.size,
        rank: { rows, cols },
        expectedSum: Number(calculatedSum.toFixed(8))
      });
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 Binaire Multi-User Queueing Engine running!`);
  console.log(`📡 HTTP API on http://localhost:${PORT}`);
  console.log(`⚡ WebSocket stream on ws://localhost:${PORT}/ws`);
  console.log(`====================================================`);
});

process.on('SIGINT', () => {
  queueManager.destroy();
  process.exit(0);
});
