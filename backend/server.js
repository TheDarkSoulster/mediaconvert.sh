const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();

const PORT = Number(process.env.PORT || 3000);
const HOST = '127.0.0.1';
const TMP_DIR = path.join(__dirname, '../.tmp');
const DIST_DIR = path.join(__dirname, '../dist');

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

app.disable('x-powered-by');
app.use(express.static(DIST_DIR, { index: 'index.html' }));

const allowedFormats = new Set(['mp4', 'mkv', 'webm', 'mov', 'mp3', 'wav', 'flac', 'png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'bmp', 'tiff']);

const storage = multer.diskStorage({
  destination: TMP_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).slice(0, 16).replace(/[^a-zA-Z0-9.]/g, '');
    const token = crypto.randomBytes(16).toString('hex');
    cb(null, `${Date.now()}-${token}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    files: 1,
    fileSize: 50 * 1024 * 1024 * 1024,
  },
});

const activeJobs = new Map();

function safeTargetFormat(value) {
  return typeof value === 'string' && allowedFormats.has(value) ? value : null;
}

function getMediaKind(metadata, originalName) {
  const videoStream = metadata.streams?.find((stream) => stream.codec_type === 'video');
  const audioStream = metadata.streams?.find((stream) => stream.codec_type === 'audio');
  const extension = path.extname(originalName).toLowerCase();
  const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.bmp', '.tif', '.tiff']);

  if (imageExtensions.has(extension)) return 'image';
  if (videoStream) return 'video';
  if (audioStream) return 'audio';
  return 'other';
}

function cleanupJob(id) {
  const job = activeJobs.get(id);
  if (!job) return;
  for (const candidate of [job.filePath, ...job.outputPaths]) {
    fs.unlink(candidate, () => {});
  }
  activeJobs.delete(id);
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file was uploaded.' });
  }

  const filePath = req.file.path;
  const originalName = req.file.originalname;

  ffmpeg.ffprobe(filePath, (err, metadata) => {
    if (err) {
      fs.unlink(filePath, () => {});
      return res.status(422).json({ error: 'FFmpeg could not read this file.' });
    }

    const jobId = req.file.filename;
    activeJobs.set(jobId, {
      filePath,
      originalName,
      metadata,
      outputPaths: new Set(),
      status: 'idle',
      process: null,
    });

    res.json({ jobId, originalName, metadata, mediaKind: getMediaKind(metadata, originalName) });
  });
});

function determineFFmpegArgs(cmd, metadata, targetFormat) {
  const videoStream = metadata.streams?.find((stream) => stream.codec_type === 'video');
  const audioStream = metadata.streams?.find((stream) => stream.codec_type === 'audio');

  const imageCodecs = {
    png: 'png',
    jpg: 'mjpeg',
    jpeg: 'mjpeg',
    webp: 'libwebp',
    avif: 'libaom-av1',
    gif: 'gif',
    bmp: 'bmp',
    tiff: 'tiff',
  };

  if (imageCodecs[targetFormat]) {
    if (!videoStream) throw new Error('This file does not contain a video/image stream.');

    // Image outputs intentionally produce one frame. For an animated input
    // such as GIF, WebP, or video, this means the first frame.
    cmd.noAudio().videoCodec(imageCodecs[targetFormat]).frames(1);

    if (targetFormat === 'jpg' || targetFormat === 'jpeg') {
      return cmd.outputOptions('-q:v', '2');
    }

    if (targetFormat === 'webp') {
      return cmd.outputOptions('-q:v', '90');
    }

    if (targetFormat === 'avif') {
      return cmd.outputOptions('-still-picture', '1', '-crf', '18');
    }

    return cmd;
  }

  const remuxVideo =
    targetFormat === 'mkv' ||
    (targetFormat === 'mp4' && videoStream?.codec_name === 'h264');

  if (targetFormat === 'mp3') {
    if (!audioStream) throw new Error('No audio stream found in this file.');
    return cmd.noVideo().audioCodec('libmp3lame').audioBitrate('320k');
  }

  if (targetFormat === 'wav') {
    if (!audioStream) throw new Error('No audio stream found in this file.');
    return cmd.noVideo().audioCodec('pcm_s16le');
  }

  if (targetFormat === 'flac') {
    if (!audioStream) throw new Error('No audio stream found in this file.');
    return cmd.noVideo().audioCodec('flac');
  }

  if (targetFormat === 'mp4' || targetFormat === 'mkv' || targetFormat === 'webm' || targetFormat === 'mov') {
    if (videoStream) {
      if (targetFormat === 'webm') {
        cmd.videoCodec('libvpx-vp9').addOption('-crf', '30').addOption('-b:v', '0');
      } else if (remuxVideo && (targetFormat === 'mp4' || targetFormat === 'mkv')) {
        cmd.videoCodec('copy');
      } else {
        cmd.videoCodec('libx264').addOption('-crf', '18').addOption('-preset', 'medium');
      }
    }

    if (audioStream) {
      const canCopyAudio =
        targetFormat === 'mp4' &&
        remuxVideo &&
        audioStream.codec_name === 'aac';
      if (targetFormat === 'webm') {
        cmd.audioCodec('libopus').audioBitrate('160k');
      } else if (canCopyAudio) {
        cmd.audioCodec('copy');
      } else {
        cmd.audioCodec(targetFormat === 'mkv' ? 'aac' : 'aac').audioBitrate('192k');
      }
    }

    if (targetFormat === 'mp4' || targetFormat === 'mov') {
      cmd.outputOptions('-movflags', '+faststart');
    }

    if (!videoStream && !audioStream) {
      throw new Error('No supported audio or video stream was found.');
    }

    return cmd;
  }

  throw new Error(`Unsupported output format: ${targetFormat}`);
}

app.get('/api/convert/:id', (req, res) => {
  const { id } = req.params;
  const targetFormat = safeTargetFormat(req.query.format || 'mp4');
  const job = activeJobs.get(id);

  if (!targetFormat) return res.status(400).send('Unsupported output format.');
  if (!job) return res.status(404).send('Job not found.');
  if (job.status === 'processing') return res.status(409).send('This job is already processing.');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const outputPath = path.join(TMP_DIR, `out_${id}.${targetFormat}`);
  job.outputPaths.add(outputPath);
  job.status = 'processing';

  let cmd;
  try {
    cmd = determineFFmpegArgs(ffmpeg(job.filePath), job.metadata, targetFormat);
  } catch (error) {
    job.status = 'error';
    res.write(`data: ${JSON.stringify({ status: 'error', message: error.message })}\n\n`);
    res.end();
    return;
  }

  job.process = cmd;

  const send = (payload) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  req.on('close', () => {
    // Closing the browser connection should not silently kill FFmpeg. The job continues locally.
  });

  cmd
    .on('progress', (progress) => {
      send({ percent: Number(progress.percent || 0), status: 'processing' });
    })
    .on('end', () => {
      job.status = 'complete';
      job.process = null;
      send({ percent: 100, status: 'complete' });
      res.end();
    })
    .on('error', (err) => {
      job.status = 'error';
      job.process = null;
      fs.unlink(outputPath, () => {});
      send({ status: 'error', message: err.message || 'FFmpeg conversion failed.' });
      res.end();
    })
    .save(outputPath);
});

app.get('/api/download/:id', (req, res) => {
  const { id } = req.params;
  const format = safeTargetFormat(req.query.format || 'mp4');
  const job = activeJobs.get(id);

  if (!format) return res.status(400).send('Unsupported output format.');
  if (!job) return res.status(404).send('Job not found.');

  const outputPath = path.join(TMP_DIR, `out_${id}.${format}`);

  if (!fs.existsSync(outputPath)) {
    return res.status(404).send('Converted file not found.');
  }

  const sanitizedBase = path.basename(job.originalName, path.extname(job.originalName))
    .replace(/[^a-zA-Z0-9 _.-]/g, '_')
    .slice(0, 120) || 'converted';

  res.download(outputPath, `${sanitizedBase}.${format}`, (err) => {
    if (!err) cleanupJob(id);
  });
});

app.use((req, res) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/') && fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
    return res.sendFile(path.join(DIST_DIR, 'index.html'));
  }
  res.status(404).send('Not found.');
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  console.error(err);
  if (!res.headersSent) res.status(500).json({ error: 'Internal server error.' });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`Backend attached securely to ${HOST}:${PORT}`);
});

function shutdown() {
  for (const job of activeJobs.values()) {
    if (job.process) {
      try { job.process.kill('SIGTERM'); } catch (_) { /* best effort */ }
    }
  }
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
