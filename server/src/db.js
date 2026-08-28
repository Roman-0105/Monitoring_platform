// Единый пул подключений к MS SQL Server (GeoLocation, RAYWEBV04).
// Переиспользуется всеми роутами через getPool().
const sql = require('mssql');

let poolPromise = null;

function buildConfig() {
  const trusted = String(process.env.MSSQL_TRUSTED_CONNECTION || '').toLowerCase() === 'true';
  const config = {
    server: process.env.MSSQL_SERVER,
    database: process.env.MSSQL_DATABASE,
    options: {
      encrypt: false, // внутрисетевой сервер; включите true, если IT требует TLS
      trustServerCertificate: true,
    },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
  };
  if (trusted) {
    config.authentication = { type: 'ntlm', options: { domain: process.env.MSSQL_DOMAIN || '', userName: '', password: '' } };
  } else {
    config.user = process.env.MSSQL_USER;
    config.password = process.env.MSSQL_PASSWORD;
  }
  return config;
}

function getPool() {
  if (!poolPromise) {
    poolPromise = sql.connect(buildConfig()).catch((err) => {
      poolPromise = null; // разрешаем повторную попытку подключения при следующем запросе
      throw err;
    });
  }
  return poolPromise;
}

module.exports = { sql, getPool };
