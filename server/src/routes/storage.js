// POST /api/storage/:bucket — замена supabase.storage.from(bucket).upload().
// Пишет файл на диск под FILES_ROOT/<bucket>/<path>, тот же путь потом
// отдаёт IIS Virtual Directory на чтение — Node в раздаче файлов не участвует.
const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const multer = require('multer');
const { requireIdentity } = require('../middleware/identity.js');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const KNOWN_BUCKETS = new Set(['photos', 'schemes', 'sump-models', 'chem-scans', 'pit3d-models']);

function safeBucket(bucket) {
  if (!KNOWN_BUCKETS.has(bucket)) {
    const err = new Error(`Неизвестный bucket: ${bucket}`);
    err.status = 400;
    throw err;
  }
  return bucket;
}

// Запрещаем выход за пределы каталога бакета через "..", допускаем вложенные
// подпапки (как storagePath вида "pointId/12345_file.jpg" у Supabase Storage).
function safeRelPath(relPath) {
  const normalized = path.normalize(relPath).replace(/^([./\\])+/, '');
  if (normalized.split(/[/\\]/).includes('..')) {
    const err = new Error('Недопустимый путь файла');
    err.status = 400;
    throw err;
  }
  return normalized;
}

router.post('/storage/:bucket', requireIdentity, upload.single('file'), async (req, res, next) => {
  try {
    const bucket = safeBucket(req.params.bucket);
    const relPath = safeRelPath(req.body.path || req.file.originalname);
    const fullPath = path.join(process.env.FILES_ROOT, bucket, relPath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, req.file.buffer);
    const publicUrl = `${process.env.FILES_PUBLIC_BASE_URL}/${bucket}/${relPath.replace(/\\/g, '/')}`;
    res.json({ path: relPath, publicUrl });
  } catch (err) {
    next(err);
  }
});

router.delete('/storage/:bucket', requireIdentity, express.json(), async (req, res, next) => {
  try {
    const bucket = safeBucket(req.params.bucket);
    const relPath = safeRelPath(req.body.path);
    const fullPath = path.join(process.env.FILES_ROOT, bucket, relPath);
    await fs.unlink(fullPath).catch((e) => { if (e.code !== 'ENOENT') throw e; });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
