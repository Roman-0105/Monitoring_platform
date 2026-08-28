// GET /api/whoami — заменяет Supabase Auth getSession()/getProfile() в
// web-next/src/lib/auth.js. Роль/статус активности читаются из APP_USERS
// по Windows-логину; если строки ещё нет — пользователь известен IIS
// (прошёл AD-группу), но роль ему ещё не назначил Главный Админ.
const express = require('express');
const { sql, getPool } = require('../db.js');
const { requireIdentity } = require('../middleware/identity.js');

const router = express.Router();

router.get('/whoami', requireIdentity, async (req, res, next) => {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('login', sql.NVarChar, req.windowsLogin)
      .query('SELECT login, display_name, role, active FROM dbo.APP_USERS WHERE login = @login');
    const row = result.recordset[0];
    res.json({
      login: req.windowsLogin,
      displayName: row ? row.display_name : req.windowsLogin,
      role: row ? row.role : null,
      active: row ? !!row.active : false,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
