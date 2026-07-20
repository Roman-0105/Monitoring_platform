/**
 * ui-login.js — экран входа.
 * Показывается поверх приложения пока пользователь не авторизован.
 */

var LoginScreen = (function() {

  function show(errorMsg) {
    var existing = document.getElementById('login-screen');
    if (existing) existing.remove();

    var el = document.createElement('div');
    el.id = 'login-screen';
    el.innerHTML = [
      '<div class="login-card">',
        '<div class="login-logo">',
          '<div class="login-logo-icon">⛏</div>',
          '<div class="login-logo-title">Мониторинг карьера</div>',
        '</div>',
        '<form id="login-form" autocomplete="on">',
          '<div class="login-field">',
            '<label class="login-label">Email</label>',
            '<input class="login-input" id="login-email" type="email" ',
              'autocomplete="email" placeholder="user@example.com" required>',
          '</div>',
          '<div class="login-field">',
            '<label class="login-label">Пароль</label>',
            '<input class="login-input" id="login-password" type="password" ',
              'autocomplete="current-password" placeholder="••••••••" required>',
          '</div>',
          errorMsg
            ? '<div class="login-error">' + escHTML(errorMsg) + '</div>'
            : '',
          '<button class="login-btn" id="login-submit" type="submit">Войти</button>',
        '</form>',
      '</div>',
    ].join('');

    // Inject styles
    if (!document.getElementById('login-styles')) {
      var style = document.createElement('style');
      style.id = 'login-styles';
      style.textContent = [
        '#login-screen{position:fixed;inset:0;background:var(--bg-primary,#0f1117);',
          'display:flex;align-items:center;justify-content:center;z-index:10000}',
        '.login-card{background:var(--bg-secondary,#1e2530);border:1px solid rgba(255,255,255,.08);',
          'border-radius:16px;padding:40px 36px;width:min(400px,90vw);box-shadow:0 8px 40px rgba(0,0,0,.4)}',
        '.login-logo{text-align:center;margin-bottom:32px}',
        '.login-logo-icon{font-size:40px;margin-bottom:8px}',
        '.login-logo-title{font-size:18px;font-weight:600;color:var(--text-primary,#e8eaf0)}',
        '.login-label{display:block;font-size:12px;color:var(--text-secondary,#9aa0b4);',
          'margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px}',
        '.login-field{margin-bottom:18px}',
        '.login-input{width:100%;padding:10px 14px;background:var(--bg-input,rgba(255,255,255,.05));',
          'border:1px solid rgba(255,255,255,.1);border-radius:8px;color:var(--text-primary,#e8eaf0);',
          'font-size:14px;box-sizing:border-box;outline:none;transition:border .2s}',
        '.login-input:focus{border-color:#1a73e8}',
        '.login-btn{width:100%;padding:12px;background:#1a73e8;border:none;border-radius:8px;',
          'color:#fff;font-size:15px;font-weight:600;cursor:pointer;transition:background .2s;margin-top:4px}',
        '.login-btn:hover{background:#1558b0}',
        '.login-btn:disabled{background:#444;cursor:not-allowed}',
        '.login-error{background:rgba(234,67,53,.15);border:1px solid rgba(234,67,53,.4);',
          'border-radius:8px;padding:10px 14px;color:#ea4335;font-size:13px;margin-bottom:16px}',
      ].join('');
      document.head.appendChild(style);
    }

    document.body.appendChild(el);

    var form   = document.getElementById('login-form');
    var btn    = document.getElementById('login-submit');
    var emailEl = document.getElementById('login-email');

    // Focus email
    setTimeout(function() { if (emailEl) emailEl.focus(); }, 50);

    form.addEventListener('submit', function(e) {
      e.preventDefault();
      var email    = document.getElementById('login-email').value.trim();
      var password = document.getElementById('login-password').value;
      btn.disabled = true;
      btn.textContent = 'Вход...';
      Auth.signIn(email, password).then(function() {
        return Auth.getProfile();
      }).then(function(profile) {
        AppState.currentUser = profile;
        hide();
        initApp();
      }).catch(function(err) {
        show(err.message === 'Invalid login credentials'
          ? 'Неверный email или пароль'
          : err.message);
      });
    });
  }

  function hide() {
    var el = document.getElementById('login-screen');
    if (el) el.remove();
  }

  return { show, hide };
})();
