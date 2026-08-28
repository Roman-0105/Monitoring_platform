import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY          = Deno.env.get('SUPABASE_ANON_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Роли, которые эта функция разрешает назначать через API. 'super_admin'
// намеренно исключён — Главный Админ только один, назначается напрямую в БД.
const ASSIGNABLE_ROLES = ['admin', 'senior_engineer', 'engineer', 'guest']

function normalizeRole(role: unknown): string {
  return ASSIGNABLE_ROLES.includes(role as string) ? (role as string) : 'guest'
}

function genTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Verify caller identity
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return new Response('Unauthorized', { status: 401, headers: corsHeaders })

    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: userErr } = await callerClient.auth.getUser()
    if (userErr || !user) return new Response('Unauthorized', { status: 401, headers: corsHeaders })

    // Управлять пользователями и ролями может только Главный Админ.
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const { data: profile } = await adminClient.from('profiles').select('role').eq('id', user.id).single()
    if (profile?.role !== 'super_admin') return new Response('Forbidden', { status: 403, headers: corsHeaders })

    const body = await req.json()

    // ── Create user ───────────────────────────────────────
    if (body.action === 'create') {
      const { email, displayName, role } = body
      if (!email || !displayName) {
        return new Response(JSON.stringify({ error: 'email и displayName обязательны' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      const tempPassword = genTempPassword()
      const { data, error } = await adminClient.auth.admin.createUser({
        email, password: tempPassword, email_confirm: true,
      })
      if (error) return new Response(JSON.stringify({ error: error.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

      await adminClient.from('profiles').insert({
        id: data.user.id,
        display_name: displayName,
        role: normalizeRole(role),
      })
      return new Response(JSON.stringify({ id: data.user.id, email: data.user.email, tempPassword }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── Delete user ───────────────────────────────────────
    if (body.action === 'delete') {
      if (body.userId === user.id) {
        return new Response(JSON.stringify({ error: 'Нельзя удалить себя' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      const { data: targetProfile } = await adminClient.from('profiles').select('role').eq('id', body.userId).single()
      if (targetProfile?.role === 'super_admin') {
        return new Response(JSON.stringify({ error: 'Нельзя удалить Главного Админа' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      const { error } = await adminClient.auth.admin.deleteUser(body.userId)
      if (error) return new Response(JSON.stringify({ error: error.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      await adminClient.from('profiles').delete().eq('id', body.userId)
      return new Response(JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── List users ────────────────────────────────────────
    if (body.action === 'list') {
      const { data, error } = await adminClient.auth.admin.listUsers({ perPage: 1000 })
      if (error) return new Response(JSON.stringify({ error: error.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

      const { data: profiles } = await adminClient.from('profiles').select('*')
      const pm = Object.fromEntries((profiles || []).map((p: any) => [p.id, p]))

      const users = data.users.map((u: any) => ({
        id:          u.id,
        email:       u.email,
        displayName: pm[u.id]?.display_name || '',
        role:        pm[u.id]?.role || 'guest',
        active:      pm[u.id]?.active !== false,
        createdAt:   u.created_at,
      }))
      return new Response(JSON.stringify({ users }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── Update user ───────────────────────────────────────
    if (body.action === 'update') {
      const { userId, displayName, role, active } = body
      if (!userId || !displayName) {
        return new Response(JSON.stringify({ error: 'userId и displayName обязательны' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      const { data: targetProfile } = await adminClient.from('profiles').select('role').eq('id', userId).single()
      if (targetProfile?.role === 'super_admin') {
        return new Response(JSON.stringify({ error: 'Роль Главного Админа нельзя изменить здесь' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      const { error: profileErr } = await adminClient.from('profiles')
        .update({ display_name: displayName, role: normalizeRole(role), active: active !== false })
        .eq('id', userId)
      if (profileErr) return new Response(JSON.stringify({ error: profileErr.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

      return new Response(JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── Reset password ──────────────────────────────────────
    if (body.action === 'reset_password') {
      const { userId } = body
      if (!userId) {
        return new Response(JSON.stringify({ error: 'userId обязателен' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      const tempPassword = genTempPassword()
      const { error } = await adminClient.auth.admin.updateUserById(userId, { password: tempPassword })
      if (error) return new Response(JSON.stringify({ error: error.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      return new Response(JSON.stringify({ tempPassword }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    return new Response('Unknown action', { status: 400, headers: corsHeaders })
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
