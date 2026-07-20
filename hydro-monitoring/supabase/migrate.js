/**
 * migrate.js — перенос данных из Google Sheets CSV → Supabase
 *
 * Использование:
 *   1. npm install @supabase/supabase-js csv-parse
 *   2. Создайте папку ./csv/ рядом с этим скриптом
 *   3. Положите CSV-файлы в ./csv/ (названия указаны ниже)
 *   4. Вставьте SERVICE_KEY
 *   5. node migrate.js
 *
 * Названия файлов:
 *   csv/points.csv        — лист «Точки»
 *   csv/workers.csv       — лист «Сотрудники»
 *   csv/ditches.csv       — лист «Канавы»
 *   csv/schemes.csv       — лист «Схемы» (опционально)
 *
 * Листы «История», «ИсторияКанав», «Фото» — не нужны.
 * История теперь = фильтр по point_number / ditch_name.
 */

const { createClient } = require('@supabase/supabase-js');
const { parse }        = require('csv-parse/sync');
const fs               = require('fs');
const path             = require('path');

// ── ЗАПОЛНИТЕ ЭТО ────────────────────────────────────────────
const CONFIG = {
  SUPABASE_URL: 'https://dusmrxvybojyrqmmqxjx.supabase.co',
  SERVICE_KEY:  'ВСТАВЬТЕ_СЮДА_service_role_ключ',  // sb_secret_...
  CSV_DIR:      './csv',
};
// ─────────────────────────────────────────────────────────────

const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SERVICE_KEY);

// ── Утилиты ──────────────────────────────────────────────────

function readCsv(fileName) {
  const filePath = path.join(CONFIG.CSV_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    console.warn(`  ⚠  ${filePath} не найден — пропускаем`);
    return [];
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  return parse(content, { columns: true, skip_empty_lines: true, trim: true });
}

function toDate(raw) {
  if (!raw || raw === '') return null;
  const dot = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (dot) return `${dot[3]}-${dot[2].padStart(2,'0')}-${dot[1].padStart(2,'0')}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return null;
}

function toFloat(v) { const n = parseFloat(v); return isNaN(n) ? null : n; }
function toInt(v)   { const n = parseInt(v, 10); return isNaN(n) ? null : n; }
function toBool(v)  { return v === 'FALSE' || v === 'false' || v === '0' ? false : true; }

function parseJsonArray(raw) {
  if (!raw || raw === '') return [];
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; }
}

function chunks(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function insertBatch(table, rows) {
  if (!rows.length) { console.log(`  ${table}: нет данных`); return 0; }
  let total = 0;
  for (const batch of chunks(rows, 200)) {
    const { error } = await supabase.from(table).upsert(batch, { ignoreDuplicates: false });
    if (error) {
      console.error(`  ❌ ${table} ошибка:`, error.message);
      console.error('     Пример строки:', JSON.stringify(batch[0]));
      process.exit(1);
    }
    total += batch.length;
  }
  console.log(`  ✅ ${table}: ${total} строк`);
  return total;
}

// ── Миграция точек ────────────────────────────────────────────

async function migratePoints() {
  console.log('\n📍 Точки...');
  const rows = readCsv('points.csv');
  const data = rows.filter(r => r.id).map(r => ({
    id:              r.id,
    point_number:    r.pointNumber     || '',
    monitoring_date: toDate(r.monitoringDate),
    worker:          r.worker          || '',
    lat:             toFloat(r.lat),
    lon:             toFloat(r.lon),
    x_local:         toFloat(r.xLocal),
    y_local:         toFloat(r.yLocal),
    status:          r.status          || 'Новая',
    intensity:       r.intensity       || '',
    flow_rate:       toFloat(r.flowRate),
    water_color:     r.waterColor      || '',
    wall:            r.wall            || '',
    domain:          r.domain          || '',
    measure_method:  r.measureMethod   || '',
    horizon:         r.horizon         || '',
    comment:         r.comment         || '',
    photos:          [],    // Drive-ссылки недоступны — фото загружать заново
    created_at:      r.createdAt       || new Date().toISOString(),
  }));
  await insertBatch('points', data);
}

// ── Миграция сотрудников ──────────────────────────────────────

async function migrateWorkers() {
  console.log('\n👷 Сотрудники...');
  const rows = readCsv('workers.csv');
  const data = rows.filter(r => r.id).map(r => ({
    id:         r.id,
    name:       r.name || '',
    active:     toBool(r.active),
    created_at: r.createdAt || new Date().toISOString(),
  }));
  await insertBatch('workers', data);
}

// ── Миграция канав ────────────────────────────────────────────

async function migrateDitches() {
  console.log('\n🏗  Канавы...');
  const rows = readCsv('ditches.csv');
  const data = rows.filter(r => r.id).map(r => ({
    id:              r.id,
    point_number:    r.pointNumber     || '',
    ditch_name:      r.ditchName       || '',
    monitoring_date: toDate(r.monitoringDate),
    worker:          r.worker          || '',
    lat:             toFloat(r.lat),
    lon:             toFloat(r.lon),
    x_local:         toFloat(r.xLocal),
    y_local:         toFloat(r.yLocal),
    status:          r.status          || 'Активная',
    width:           toFloat(r.width),
    vel_method:      r.velMethod       || 'single',
    velocity:        toFloat(r.velocity),
    float_l:         toFloat(r.floatL),
    float_t:         toFloat(r.floatT),
    float_k:         toFloat(r.floatK),
    dist_mode:       r.distMode        || 'u',
    n_points:        toInt(r.nPoints),
    depths:          parseJsonArray(r.depths),
    dists:           parseJsonArray(r.dists),
    area:            toFloat(r.area),
    flow_m3h:        toFloat(r.flowM3h),
    comment:         r.comment         || '',
    photos:          [],
    created_at:      r.createdAt       || new Date().toISOString(),
  }));
  await insertBatch('ditches', data);
}

// ── Миграция схем (только метаданные) ────────────────────────

async function migrateSchemes() {
  console.log('\n🗺  Схемы...');
  const rows = readCsv('schemes.csv');
  if (!rows.length) return;
  // Схемы без изображений — только метаданные.
  // Сами изображения нужно загрузить вручную в Supabase Storage → schemes
  const data = rows.filter(r => r.weekKey).map(r => ({
    week_key:     r.weekKey,
    storage_path: r.weekKey + '.jpg',  // путь в Storage — после ручной загрузки
    uploaded_at:  r.uploadedAt || new Date().toISOString(),
    uploaded_by:  r.uploadedBy || '',
  }));
  await insertBatch('schemes', data);
  console.log('  ℹ  Изображения схем нужно загрузить вручную в Storage → schemes');
}

// ── Главная функция ───────────────────────────────────────────

async function main() {
  console.log('🚀 Миграция данных в Supabase');
  console.log(`   URL: ${CONFIG.SUPABASE_URL}\n`);

  if (CONFIG.SERVICE_KEY.includes('ВСТАВЬТЕ')) {
    console.error('❌ Заполните SERVICE_KEY в CONFIG!');
    process.exit(1);
  }

  if (!fs.existsSync(CONFIG.CSV_DIR)) {
    console.error(`❌ Папка ${CONFIG.CSV_DIR} не найдена.`);
    process.exit(1);
  }

  const { error } = await supabase.from('workers').select('id').limit(1);
  if (error) {
    console.error('❌ Ошибка подключения:', error.message);
    process.exit(1);
  }
  console.log('✅ Supabase подключён');

  await migrateWorkers();
  await migratePoints();
  await migrateDitches();
  await migrateSchemes();

  console.log('\n🎉 Готово!');
  console.log('⚠  Фотографии не перенесены — их нужно загружать заново через сайт.');
}

main().catch(err => { console.error('💥', err); process.exit(1); });
