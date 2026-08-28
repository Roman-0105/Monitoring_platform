// Универсальный REST-роут /api/:table — то, во что shim-клиент
// (web-next/src/lib/supabase.js) транслирует .from(table).select()/.insert()/
// .update()/.upsert()/.delete(). Синтаксис фильтров/сортировки — как у
// PostgREST (см. query-engine.js) для минимальных изменений в shim-клиенте.
const express = require('express');
const { requireIdentity } = require('../middleware/identity.js');
const qe = require('../query-engine.js');

const router = express.Router();
router.use(express.json({ limit: '20mb' }));

router.get('/:table', requireIdentity, async (req, res, next) => {
  try {
    const { select, order, limit, range } = req.query;
    const filters = qe.parseFilters(req.query);
    const rows = await qe.selectRows({ table: req.params.table, select, filters, order, limit, range });
    if (range) {
      // Имитация Content-Range PostgREST — фронт сегодня определяет "есть ли ещё
      // страница" по длине ответа (< pageSize), заголовок не обязателен, но не мешает.
      res.set('Content-Range', `${range}/*`);
    }
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/:table', requireIdentity, async (req, res, next) => {
  try {
    const { rows, upsert, onConflict, select } = req.body;
    const fn = upsert ? qe.upsertRows : qe.insertRows;
    const result = await fn({ table: req.params.table, rows, onConflict, select });
    res.json(result);
  } catch (err) { next(err); }
});

router.patch('/:table', requireIdentity, async (req, res, next) => {
  try {
    const filters = qe.parseFilters(req.query);
    const { patch, select } = req.body;
    const result = await qe.updateRows({ table: req.params.table, patch, filters, select });
    res.json(result);
  } catch (err) { next(err); }
});

router.delete('/:table', requireIdentity, async (req, res, next) => {
  try {
    const filters = qe.parseFilters(req.query);
    await qe.deleteRows({ table: req.params.table, filters });
    res.json([]);
  } catch (err) { next(err); }
});

module.exports = router;
