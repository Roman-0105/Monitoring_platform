/**
 * run-photo-migration.js
 * Читает csv/points-with-photos.csv, скачивает фото с Google Drive,
 * загружает в Supabase Storage и обновляет photos[] у точек.
 *
 * Запуск:
 *   node run-photo-migration.js
 */

const { createClient } = require('@supabase/supabase-js');
const { parse }        = require('csv-parse/sync');
const fs               = require('fs');
const path             = require('path');
const https            = require('https');
const http             = require('http');

// ── ЗАПОЛНИТЕ ────────────────────────────────────────────────
const CONFIG = {
  SUPABASE_URL: 'https://dusmrxvybojyrqmmqxjx.supabase.co',
  SERVICE_KEY:  'ВСТАВЬТЕ_СЮДА_service_role_ключ',
  CSV_FILE:     path.join(__dirname, 'csv', 'points-with-photos.csv'),
  DELAY_MS:     400,
};
// ─────────────────────────────────────────────────────────────

const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SERVICE_KEY);

// ── Скачивание файла с поддержкой редиректов ─────────────────

function download(url, redirectsLeft) {
  redirectsLeft = redirectsLeft === undefined ? 5 : redirectsLeft;
  return new Promise(function(resolve, reject) {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    }, function(res) {
      // Редирект
      if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303 || res.statusCode === 307) && res.headers.location) {
        if (redirectsLeft <= 0) return reject(new Error('Слишком много редиректов'));
        return resolve(download(res.headers.location, redirectsLeft - 1));
      }
      if (res.statusCode !== 200) {
        return reject(new Error('HTTP ' + res.statusCode + ' для ' + url));
      }
      const contentType = (res.headers['content-type'] || 'image/jpeg').split(';')[0].trim();
      const chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() {
        const buf = Buffer.concat(chunks);
        // Google возвращает HTML-страницу подтверждения для больших файлов
        if (contentType.includes('text/html')) {
          const html = buf.toString('utf-8');
          const m = html.match(/confirm=([0-9A-Za-z_-]+)/);
          if (m) {
            const confirmUrl = url + '&confirm=' + m[1];
            return resolve(download(confirmUrl, redirectsLeft - 1));
          }
          return reject(new Error('Drive вернул HTML (файл приватный или удалён)'));
        }
        resolve({ buffer: buf, mime: contentType });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(30000, function() { req.destroy(); reject(new Error('Таймаут скачивания')); });
  });
}

function extractDriveId(url) {
  if (!url) return null;
  let m = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  return null;
}

function driveDownloadUrl(fileId) {
  return 'https://drive.google.com/uc?export=download&id=' + fileId;
}

function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

// ── Supabase ─────────────────────────────────────────────────

async function uploadToStorage(buffer, mime, pointId, idx) {
  const ext  = (mime.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  const name = Date.now() + '_' + idx + '.' + ext;
  const storagePath = pointId + '/' + name;

  const { error } = await supabase.storage
    .from('photos')
    .upload(storagePath, buffer, { contentType: mime, upsert: false });

  if (error) throw new Error('Storage: ' + error.message);

  const { data } = supabase.storage.from('photos').getPublicUrl(storagePath);
  return data.publicUrl;
}

async function updatePointPhotos(pointId, urls) {
  const { data, error: fetchErr } = await supabase
    .from('points').select('photos').eq('id', pointId).maybeSingle();
  if (fetchErr) throw new Error(fetchErr.message);

  const existing = (data && data.photos) || [];
  // Не добавляем дубли (по Supabase-URL суффиксам)
  const merged = existing.slice();
  for (const u of urls) {
    if (!merged.includes(u)) merged.unshift(u);
  }

  const { error: upErr } = await supabase
    .from('points').update({ photos: merged }).eq('id', pointId);
  if (upErr) throw new Error(upErr.message);
}

// ── Главная ──────────────────────────────────────────────────

async function main() {
  console.log('🚀 Миграция фотографий Google Drive → Supabase Storage\n');

  if (CONFIG.SERVICE_KEY.includes('ВСТАВЬТЕ')) {
    console.error('❌ Заполните SERVICE_KEY в CONFIG!');
    process.exit(1);
  }

  const csv = fs.readFileSync(CONFIG.CSV_FILE, 'utf-8');
  const rows = parse(csv, { columns: true, skip_empty_lines: true, trim: true });

  // Фильтруем только строки с фото
  const withPhotos = rows.filter(function(r) {
    if (!r.id || !r.photoUrls || r.photoUrls === '[]' || r.photoUrls === '') return false;
    let urls;
    try { urls = JSON.parse(r.photoUrls); } catch { return false; }
    return Array.isArray(urls) && urls.length > 0;
  });

  console.log('Всего строк в CSV:     ' + rows.length);
  console.log('Строк с фотографиями:  ' + withPhotos.length + '\n');

  let ok = 0, skipped = 0, failed = 0;
  const errors = [];

  for (let i = 0; i < withPhotos.length; i++) {
    const row  = withPhotos[i];
    const id   = row.id.trim();
    let driveUrls;
    try { driveUrls = JSON.parse(row.photoUrls); } catch { driveUrls = []; }

    process.stdout.write('[' + (i + 1) + '/' + withPhotos.length + '] Точка ' + (row.pointNumber || id.slice(0, 8)) + ' (' + driveUrls.length + ' фото): ');

    const uploadedUrls = [];
    let rowFailed = false;

    for (let j = 0; j < driveUrls.length; j++) {
      const driveUrl = driveUrls[j];
      const fileId   = extractDriveId(driveUrl);

      if (!fileId) {
        process.stdout.write('⚠(нет ID) ');
        continue;
      }

      try {
        const { buffer, mime } = await download(driveDownloadUrl(fileId));
        const publicUrl = await uploadToStorage(buffer, mime, id, j);
        uploadedUrls.push(publicUrl);
        process.stdout.write('✅ ');
      } catch (err) {
        process.stdout.write('❌ ');
        errors.push({ row: i + 1, pointId: id, fileId: fileId, error: err.message });
        rowFailed = true;
      }
    }

    if (uploadedUrls.length > 0) {
      try {
        await updatePointPhotos(id, uploadedUrls);
        ok++;
      } catch (err) {
        process.stdout.write('(БД ❌) ');
        errors.push({ row: i + 1, pointId: id, error: 'DB: ' + err.message });
        rowFailed = true;
      }
    }

    if (rowFailed) failed++; else if (uploadedUrls.length === 0) skipped++;
    console.log();

    if (i < withPhotos.length - 1) await sleep(CONFIG.DELAY_MS);
  }

  console.log('\n══════════════════════════════════');
  console.log('✅ Успешно:   ' + ok + ' точек');
  console.log('⚠  Пропущено: ' + skipped);
  console.log('❌ Ошибок:    ' + failed);

  if (errors.length) {
    const errFile = path.join(__dirname, 'csv', 'photo-migration-errors.json');
    fs.writeFileSync(errFile, JSON.stringify(errors, null, 2));
    console.log('\nПодробности ошибок: ' + errFile);
  }
}

main().catch(function(err) { console.error('💥', err); process.exit(1); });
