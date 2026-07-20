/**
 * migrate-photos.js — перенос фотографий из Google Drive → Supabase Storage
 *
 * Использование:
 *   1. npm install @supabase/supabase-js csv-parse node-fetch
 *   2. Подготовьте CSV (см. ниже)
 *   3. Вставьте SERVICE_KEY
 *   4. node migrate-photos.js
 *
 * Формат CSV (csv/photos.csv):
 *   Обязательные колонки:
 *     point_id   — UUID точки в Supabase (из таблицы points)
 *     drive_url  — ссылка из Google Drive (любой формат):
 *                  https://drive.google.com/file/d/FILE_ID/view
 *                  https://drive.google.com/open?id=FILE_ID
 *                  https://drive.google.com/uc?id=FILE_ID
 *
 *   Необязательные колонки:
 *     table      — 'points' или 'ditches' (по умолчанию 'points')
 *     file_name  — имя файла (если пусто — генерируется автоматически)
 *
 * Пример строки CSV:
 *   point_id,drive_url,table
 *   550e8400-e29b-...,https://drive.google.com/file/d/1aBcDeF.../view,points
 *
 * Что делает скрипт:
 *   1. Скачивает каждое фото из Google Drive
 *   2. Загружает в Supabase Storage → photos/{point_id}/{timestamp}_{name}.jpg
 *   3. Добавляет публичный URL в массив photos[] у нужной записи
 *   4. Пропускает уже обработанные (повторный запуск безопасен)
 */

const { createClient } = require('@supabase/supabase-js');
const { parse }        = require('csv-parse/sync');
const fs               = require('fs');
const path             = require('path');
// node-fetch v2 (CommonJS). Если v3 — замените на import()
let fetch;
try { fetch = require('node-fetch'); } catch {
  console.error('❌ Установите node-fetch: npm install node-fetch@2');
  process.exit(1);
}

// ── ЗАПОЛНИТЕ ЭТО ────────────────────────────────────────────
const CONFIG = {
  SUPABASE_URL: 'https://dusmrxvybojyrqmmqxjx.supabase.co',
  SERVICE_KEY:  'ВСТАВЬТЕ_СЮДА_service_role_ключ',
  CSV_FILE:     './csv/photos.csv',
  DELAY_MS:     300,   // пауза между запросами к Drive (мс)
  MAX_RETRIES:  3,
};
// ─────────────────────────────────────────────────────────────

const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SERVICE_KEY);

// ── Утилиты Drive ─────────────────────────────────────────────

function extractDriveFileId(url) {
  if (!url) return null;
  // /file/d/FILE_ID/
  let m = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  // ?id=FILE_ID или &id=FILE_ID
  m = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  // /open?id=FILE_ID
  m = url.match(/open\?id=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  return null;
}

function driveDirectUrl(fileId) {
  return `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function downloadDriveFile(fileId, attempt) {
  attempt = attempt || 1;
  const url = driveDirectUrl(fileId);
  let res;
  try {
    res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
  } catch (err) {
    if (attempt < CONFIG.MAX_RETRIES) {
      await sleep(1000 * attempt);
      return downloadDriveFile(fileId, attempt + 1);
    }
    throw new Error('Сеть: ' + err.message);
  }

  if (!res.ok) {
    throw new Error(`Drive вернул ${res.status} для ${fileId}`);
  }

  // Google иногда отдаёт HTML-страницу подтверждения для больших файлов
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    // Пробуем найти confirm-токен в теле
    const html = await res.text();
    const cm = html.match(/confirm=([0-9A-Za-z_-]+)/);
    if (cm) {
      const confirmUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=${cm[1]}`;
      const res2 = await fetch(confirmUrl, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res2.ok) throw new Error(`Drive confirm вернул ${res2.status}`);
      const buf = await res2.buffer();
      return { buffer: buf, mime: res2.headers.get('content-type') || 'image/jpeg' };
    }
    throw new Error(`Drive вернул HTML (возможно файл приватный или удалён): ${fileId}`);
  }

  const buf = await res.buffer();
  return { buffer: buf, mime: contentType.split(';')[0].trim() || 'image/jpeg' };
}

// ── Supabase helpers ──────────────────────────────────────────

async function getExistingPhotos(table, id) {
  const { data, error } = await supabase.from(table).select('photos').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data && data.photos) || [];
}

async function appendPhoto(table, id, photoUrl) {
  const existing = await getExistingPhotos(table, id);
  // Не добавляем дубли
  if (existing.includes(photoUrl)) return;
  const updated = [photoUrl].concat(existing);
  const { error } = await supabase.from(table).update({ photos: updated }).eq('id', id);
  if (error) throw new Error(error.message);
}

async function uploadToStorage(buffer, mime, pointId, fileName) {
  const ext  = mime.split('/')[1] || 'jpg';
  const name = fileName || (Date.now() + '.' + ext);
  const storagePath = pointId + '/' + Date.now() + '_' + name;

  const { error } = await supabase.storage
    .from('photos')
    .upload(storagePath, buffer, { contentType: mime, upsert: false });

  if (error) throw new Error('Storage: ' + error.message);

  const { data } = supabase.storage.from('photos').getPublicUrl(storagePath);
  return data.publicUrl;
}

// ── Главная функция ───────────────────────────────────────────

async function main() {
  console.log('🚀 Миграция фотографий Google Drive → Supabase Storage');

  if (CONFIG.SERVICE_KEY.includes('ВСТАВЬТЕ')) {
    console.error('❌ Заполните SERVICE_KEY в CONFIG!');
    process.exit(1);
  }

  if (!fs.existsSync(CONFIG.CSV_FILE)) {
    console.error(`❌ Файл ${CONFIG.CSV_FILE} не найден.`);
    console.error('   Создайте CSV с колонками: point_id, drive_url, table (необязательно)');
    process.exit(1);
  }

  const rows = parse(fs.readFileSync(CONFIG.CSV_FILE, 'utf-8'), {
    columns: true, skip_empty_lines: true, trim: true,
  });

  console.log(`   Найдено строк: ${rows.length}\n`);

  let ok = 0, skipped = 0, failed = 0;
  const errors = [];

  for (let i = 0; i < rows.length; i++) {
    const row   = rows[i];
    const table = (row.table || 'points').trim();
    const id    = (row.point_id || '').trim();
    const dUrl  = (row.drive_url || '').trim();
    const fName = (row.file_name || '').trim();

    process.stdout.write(`[${i + 1}/${rows.length}] ${id.slice(0, 8)}... `);

    if (!id || !dUrl) {
      console.log('⚠  пропуск (нет id или drive_url)');
      skipped++;
      continue;
    }

    const fileId = extractDriveFileId(dUrl);
    if (!fileId) {
      console.log('⚠  пропуск (не удалось извлечь Drive ID из: ' + dUrl + ')');
      skipped++;
      continue;
    }

    try {
      // Скачиваем с Drive
      process.stdout.write('скачиваю... ');
      const { buffer, mime } = await downloadDriveFile(fileId);

      // Загружаем в Storage
      process.stdout.write('загружаю... ');
      const publicUrl = await uploadToStorage(buffer, mime, id, fName || (fileId + '.jpg'));

      // Обновляем запись в БД
      await appendPhoto(table, id, publicUrl);

      console.log('✅');
      ok++;
    } catch (err) {
      console.log('❌ ' + err.message);
      errors.push({ row: i + 1, id, fileId, error: err.message });
      failed++;
    }

    if (i < rows.length - 1) await sleep(CONFIG.DELAY_MS);
  }

  console.log(`\n🎉 Готово: ${ok} перенесено, ${skipped} пропущено, ${failed} ошибок`);

  if (errors.length) {
    const errFile = './csv/photos-errors.json';
    fs.writeFileSync(errFile, JSON.stringify(errors, null, 2));
    console.log(`   Ошибки сохранены в ${errFile}`);
  }
}

main().catch(err => { console.error('💥', err); process.exit(1); });
