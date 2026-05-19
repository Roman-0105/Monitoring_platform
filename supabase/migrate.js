/**
 * migrate.js — перенос данных из Google Sheets CSV → Supabase
 *
 * Использование:
 *   1. npm install @supabase/supabase-js csv-parse node-fetch
 *   2. Положите CSV-файлы в папку ./csv/ рядом с этим скриптом
 *   3. Заполните CONFIG ниже (SUPABASE_URL и SERVICE_KEY)
 *   4. node migrate.js
 *
 * Порядок запуска: workers → points → history → photos → ditches → ditch_history
 * Схемы (изображения) — отдельный шаг, требует скачивания из Google Drive вручную
 */

const { createClient } = require('@supabase/supabase-js');
const { parse }        = require('csv-parse/sync');
const fs               = require('fs');
const path             = require('path');

// ── ЗАПОЛНИТЕ ЭТО ────────────────────────────────────────────
const CONFIG = {
  SUPABASE_URL: 'https://dusmrxvybojyrqmmqxjx.supabase.co',
  SERVICE_KEY:  'ВСТАВЬТЕ_СЮДА_service_role_ключ',   // sb_secret_...
  CSV_DIR:      './csv',                               // папка с CSV-файлами
};
// ─────────────────────────────────────────────────────────────

const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SERVICE_KEY);

// ── Утилиты ──────────────────────────────────────────────────

function readCsv(fileName) {
  const filePath = path.join(CONFIG.CSV_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠  Файл не найден: ${filePath} — пропускаем`);
    return [];
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  return parse(content, {
    columns:          true,   // первая строка = заголовки
    skip_empty_lines: true,
    trim:             true,
  });
}

function normalizeDate(raw) {
  if (!raw || raw === '') return null;
  // DD.MM.YYYY или DD/MM/YYYY
  const dot = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (dot) return `${dot[3]}-${dot[2].padStart(2,'0')}-${dot[1].padStart(2,'0')}`;
  // YYYY-MM-DD — уже правильный
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return null;
}

function toFloat(v) {
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function toInt(v) {
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

function toBool(v) {
  if (v === 'TRUE' || v === 'true' || v === '1') return true;
  if (v === 'FALSE' || v === 'false' || v === '0') return false;
  return true;
}

function parseJsonArray(raw, def = []) {
  if (!raw || raw === '') return def;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : def;
  } catch (_) { return def; }
}

// Разбиваем массив на части по N элементов для batch-insert
function chunks(arr, size) {
  const result = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

async function insertBatch(table, rows, batchSize = 100) {
  if (!rows.length) { console.log(`  ${table}: нет данных`); return; }
  let inserted = 0;
  for (const batch of chunks(rows, batchSize)) {
    const { error } = await supabase.from(table).upsert(batch);
    if (error) {
      console.error(`  ❌ ${table}: ошибка вставки —`, error.message);
      console.error('  Первая строка пачки:', JSON.stringify(batch[0]));
      process.exit(1);
    }
    inserted += batch.length;
  }
  console.log(`  ✅ ${table}: вставлено ${inserted} строк`);
}

// ── Миграция сотрудников ──────────────────────────────────────

async function migrateWorkers() {
  console.log('\n👷 Сотрудники...');
  const rows = readCsv('workers.csv');
  const data = rows
    .filter(r => r.id)
    .map(r => ({
      id:         r.id,
      name:       r.name || '',
      active:     toBool(r.active),
      created_at: r.createdAt || new Date().toISOString(),
      updated_at: r.updatedAt || new Date().toISOString(),
    }));
  await insertBatch('workers', data);
}

// ── Миграция точек ────────────────────────────────────────────

async function migratePoints() {
  console.log('\n📍 Точки...');
  const rows = readCsv('points.csv');
  const data = rows
    .filter(r => r.id)
    .map(r => ({
      id:              r.id,
      version:         toInt(r.version)     || 1,
      device_id:       r.deviceId           || '',
      sync_status:     'synced',
      synced_at:       r.syncedAt           || null,
      created_at:      r.createdAt          || new Date().toISOString(),
      updated_at:      r.updatedAt          || new Date().toISOString(),
      monitoring_date: normalizeDate(r.monitoringDate),
      point_number:    r.pointNumber        || '',
      worker:          r.worker             || '',
      lat:             toFloat(r.lat),
      lon:             toFloat(r.lon),
      x_local:         toFloat(r.xLocal),
      y_local:         toFloat(r.yLocal),
      intensity:       r.intensity          || '',
      flow_rate:       toFloat(r.flowRate),
      water_color:     r.waterColor         || '',
      wall:            r.wall               || '',
      domain:          r.domain             || '',
      status:          r.status             || 'Новая',
      measure_method:  r.measureMethod      || '',
      horizon:         r.horizon            || '',
      comment:         r.comment            || '',
      // photoUrls из Google Drive не переносим — они недоступны после отключения Drive
      // Фото нужно загружать заново через Supabase Storage
      photo_urls:      [],
    }));
  await insertBatch('points', data);
}

// ── Миграция истории замеров ──────────────────────────────────

async function migrateHistory() {
  console.log('\n📈 История замеров...');
  const rows = readCsv('history.csv');   // лист «История»
  const data = rows
    .filter(r => r.pointNumber)
    .map(r => ({
      point_number:    r.pointNumber    || '',
      monitoring_date: normalizeDate(r.monitoringDate),
      flow_rate:       toFloat(r.flowRate),
      flow_rate_m3h:   toFloat(r.flowRateM3h),
      status:          r.status         || '',
      intensity:       r.intensity      || '',
      measure_method:  r.measureMethod  || '',
      worker:          r.worker         || '',
      recorded_at:     r.recordedAt     || new Date().toISOString(),
    }));
  await insertBatch('history', data);
}

// ── Миграция фото (метаданные без файлов) ────────────────────

async function migratePhotos() {
  console.log('\n🖼  Фото (метаданные)...');
  const rows = readCsv('photos.csv');   // лист «Фото»
  const data = rows
    .filter(r => r.pointNumber && r.photoUrl)
    .map(r => ({
      point_number:    r.pointNumber    || '',
      monitoring_date: normalizeDate(r.monitoringDate),
      // Старый Google Drive URL — оставляем как есть, файлы уже не доступны
      // После загрузки фото через новый интерфейс URL обновятся автоматически
      photo_url:       r.photoUrl       || '',
      flow_rate:       toFloat(r.flowRate),
      uploaded_at:     r.uploadedAt     || new Date().toISOString(),
    }));
  await insertBatch('photos', data);
}

// ── Миграция канав ────────────────────────────────────────────

async function migrateDitches() {
  console.log('\n🏗  Канавы...');
  const rows = readCsv('ditches.csv');   // лист «Канавы»
  const data = rows
    .filter(r => r.id)
    .map(r => ({
      id:              r.id,
      point_number:    r.pointNumber    || '',
      ditch_name:      r.ditchName      || '',
      monitoring_date: normalizeDate(r.monitoringDate),
      worker:          r.worker         || '',
      lat:             toFloat(r.lat),
      lon:             toFloat(r.lon),
      x_local:         toFloat(r.xLocal),
      y_local:         toFloat(r.yLocal),
      status:          r.status         || 'Активная',
      width:           toFloat(r.width),
      vel_method:      r.velMethod      || 'single',
      velocity:        toFloat(r.velocity),
      float_l:         toFloat(r.floatL),
      float_t:         toFloat(r.floatT),
      float_k:         toFloat(r.floatK),
      dist_mode:       r.distMode       || 'u',
      n_points:        toInt(r.nPoints),
      depths:          parseJsonArray(r.depths),
      dists:           parseJsonArray(r.dists),
      area:            toFloat(r.area),
      flow_m3h:        toFloat(r.flowM3h),
      comment:         r.comment        || '',
      photo_urls:      [],   // фото канав переносим отдельно
      created_at:      r.createdAt      || new Date().toISOString(),
      updated_at:      r.updatedAt      || new Date().toISOString(),
    }));
  await insertBatch('ditches', data);
}

// ── Миграция истории канав ────────────────────────────────────

async function migrateDitchHistory() {
  console.log('\n📊 История канав...');
  const rows = readCsv('ditch_history.csv');   // лист «ИсторияКанав»
  const data = rows
    .filter(r => r.ditchName)
    .map(r => ({
      ditch_name:      r.ditchName      || '',
      point_number:    r.pointNumber    || '',
      monitoring_date: normalizeDate(r.monitoringDate),
      worker:          r.worker         || '',
      width:           toFloat(r.width),
      area:            toFloat(r.area),
      flow_m3h:        toFloat(r.flowM3h),
      vel_method:      r.velMethod      || '',
      recorded_at:     r.recordedAt     || new Date().toISOString(),
    }));
  await insertBatch('ditch_history', data);
}

// ── Главная функция ───────────────────────────────────────────

async function main() {
  console.log('🚀 Начало миграции данных в Supabase');
  console.log(`   URL: ${CONFIG.SUPABASE_URL}`);
  console.log(`   CSV: ${path.resolve(CONFIG.CSV_DIR)}\n`);

  if (CONFIG.SERVICE_KEY.includes('ВСТАВЬТЕ')) {
    console.error('❌ Заполните SERVICE_KEY в CONFIG!');
    process.exit(1);
  }

  if (!fs.existsSync(CONFIG.CSV_DIR)) {
    console.error(`❌ Папка ${CONFIG.CSV_DIR} не найдена. Создайте её и положите CSV-файлы.`);
    process.exit(1);
  }

  // Тест подключения
  const { error: pingError } = await supabase.from('workers').select('id').limit(1);
  if (pingError) {
    console.error('❌ Не удалось подключиться к Supabase:', pingError.message);
    process.exit(1);
  }
  console.log('✅ Supabase подключён\n');

  await migrateWorkers();
  await migratePoints();
  await migrateHistory();
  await migratePhotos();
  await migrateDitches();
  await migrateDitchHistory();

  console.log('\n🎉 Миграция завершена!');
  console.log('\nПримечание: фотографии не перенесены (Google Drive URLs недоступны).');
  console.log('Существующие фото нужно будет загрузить заново через интерфейс сайта.');
}

main().catch(err => {
  console.error('\n💥 Критическая ошибка:', err);
  process.exit(1);
});
