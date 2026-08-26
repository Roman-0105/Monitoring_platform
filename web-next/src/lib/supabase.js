// Тот же проект Supabase, что и в текущем приложении (hydro-monitoring/app.js APP_CONFIG) —
// publishable/anon-ключ безопасен для клиента по дизайну Supabase (защита на уровне RLS).
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://dusmrxvybojyrqmmqxjx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_AbYc8gJjsdC04DR-kw48EQ_jnnyqy5a';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
