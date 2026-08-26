import { supabase } from './supabase.js';

function currentWeekKey() {
  const now = new Date();
  const jan1 = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil(((now - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  return now.getFullYear() + '-W' + (week < 10 ? '0' + week : week);
}

export async function getSchemesForQuarry(quarry) {
  const { data, error } = await supabase.from('schemes').select('*').order('week_key', { ascending: false }).order('uploaded_at', { ascending: false });
  if (error) return [];
  let all = data || [];
  if (quarry) all = all.filter((r) => (r.quarry || quarry) === quarry);
  const seen = new Set();
  const rows = all.filter((r) => { if (seen.has(r.week_key)) return false; seen.add(r.week_key); return true; });
  return rows.map((r) => {
    const { data: urlData } = supabase.storage.from('schemes').getPublicUrl(r.storage_path);
    return { weekKey: r.week_key, url: urlData ? urlData.publicUrl : '', uploadedAt: r.uploaded_at || '', quarry: r.quarry || '' };
  });
}

export function getCurrentOrLatestScheme(schemes) {
  if (!schemes.length) return null;
  const wk = currentWeekKey();
  const exact = schemes.find((s) => s.weekKey === wk);
  if (exact) return exact;
  return schemes.slice().sort((a, b) => (a.weekKey > b.weekKey ? -1 : 1))[0];
}

export function formatWeekKey(weekKey) {
  const parts = (weekKey || '').split('-W');
  return parts.length === 2 ? `Неделя ${parts[1]}, ${parts[0]}` : weekKey;
}

// Возвращает {start, end} (YYYY-MM-DD, включительно) — понедельник..воскресенье ISO-недели.
export function getWeekDateRange(weekKey) {
  if (!weekKey) return null;
  const parts = (weekKey || '').split('-W');
  if (parts.length !== 2) return null;
  const year = parseInt(parts[0], 10);
  const week = parseInt(parts[1], 10);
  if (Number.isNaN(year) || Number.isNaN(week)) return null;

  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = jan4.getDay() || 7; // 1=пн..7=вс
  const monday1 = new Date(jan4);
  monday1.setDate(jan4.getDate() - (dayOfWeek - 1));

  const start = new Date(monday1);
  start.setDate(monday1.getDate() + (week - 1) * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);

  const iso = (d) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}
