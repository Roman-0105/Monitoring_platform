/*
 * Точка переключения "тестовая модель" -> "боевые данные".
 *
 * Пока API_BASE_URL = null, вся панель работает на локальных мок-данных
 * (см. data.js), которые хранятся в localStorage браузера и по структуре
 * полностью повторяют таблицы GEOLOCATION_* в SQL Server предприятия.
 *
 * Когда IT поднимет REST API поверх SQL Server (контракт описан в
 * BACKEND_INTEGRATION.md), достаточно прописать здесь реальный адрес —
 * остальной код (ui-*.js) трогать не нужно, RiskApi сам переключится
 * на сетевые запросы.
 */
window.RISK_CONFIG = {
  API_BASE_URL: null, // например: 'https://geoadmin.rggold.kz/api'
  PHOTO_BASE_URL: 'https://geoadmin.rggold.kz/static/files/',
  API_KEY: null, // см. BACKEND_INTEGRATION.md, раздел "Аутентификация"
};
