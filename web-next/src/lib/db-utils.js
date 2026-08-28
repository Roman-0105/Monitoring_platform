import { supabase } from './supabase.js';

// PostgREST по умолчанию отдаёт максимум 1000 строк за запрос — при большой
// таблице «хвост» молча обрезается. Дочитываем постранично, пока страница
// не окажется короче полного размера.
const PAGE = 1000;

export async function fetchAllRows(table, { select = '*', order, ascending = true, filter } = {}) {
  const all = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from(table).select(select);
    if (filter) q = filter(q);
    if (order) q = q.order(order, { ascending });
    q = q.range(from, from + PAGE - 1);
    const { data, error } = await q;
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return all;
}
