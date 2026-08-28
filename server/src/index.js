require('dotenv').config();
const express = require('express');
const cors = require('cors');

const tableRoutes = require('./routes/table.js');
const whoamiRoutes = require('./routes/whoami.js');
const storageRoutes = require('./routes/storage.js');

const app = express();
app.use(cors());

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api', whoamiRoutes);
app.use('/api', storageRoutes);
app.use('/api', tableRoutes);

// Единая обработка ошибок — query-engine.js кладёт err.status на известные
// (валидационные/защитные) ошибки, остальное — 500 с текстом сообщения
// (внутренний инструмент небольшой команды — детальный текст ошибки полезнее,
// чем его прятать; секреты подключения в сообщения ошибок mssql не попадают).
app.use((err, req, res, next) => {
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Внутренняя ошибка сервера' });
});

// Под iisnode процесс поднимает и слушает сам IIS (через именованный канал/сокет,
// передаётся в process.env.PORT) — просто слушаем PORT из окружения в обоих случаях.
const port = process.env.PORT || 3000;
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`geoadmin-server listening on ${port}`);
});
