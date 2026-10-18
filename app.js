// أدوات مشتركة للوحة العميل ولوحة الإدارة
(function () {
  var G = (window.G = {});
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* تجاهل */ } },
  };
  G.store = store;

  G.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  G.api = function (path, opt) {
    opt = opt || {};
    var o = { method: opt.method || 'GET', credentials: 'same-origin', headers: {} };
    if (opt.form) o.body = opt.form;
    else if (opt.body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opt.body); }
    return fetch('/api' + path, o).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || 'حدث خطأ. حاول مرة أخرى.'); e.status = r.status; throw e; }
        return j;
      });
    }, function () { throw new Error('تعذّر الاتصال بالخادم. تحقق من الإنترنت.'); });
  };

  var tt;
  G.toast = function (m) {
    var t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('aria-live', 'polite'); t.innerHTML = '<span></span>'; document.body.appendChild(t); }
    t.firstChild.textContent = m; t.classList.add('show'); clearTimeout(tt);
    tt = setTimeout(function () { t.classList.remove('show'); }, 3200);
  };

  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  G.date = function (ts) { if (!ts) return '—'; var d = new Date(ts); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  G.dateTime = function (ts) { if (!ts) return '—'; var d = new Date(ts); return G.date(ts) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  G.isoDay = function (ts) { var d = new Date(ts); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); };

  G.STATUS = { queued: ['في الطابور', 'info'], building: ['قيد البناء', 'warn'], ready: ['جاهز', 'ok'], failed: ['فشل', 'bad'] };
  G.pill = function (status) { var s = G.STATUS[status] || [status, '']; return '<span class="pill ' + s[1] + '">' + G.esc(s[0]) + '</span>'; };

  // الوضع الفاتح والداكن (نفس مفتاح صفحة الهبوط)
  G.theme = function (t) {
    if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  };
  G.theme(store.get('ghilaf-theme'));
  G.toggleTheme = function () {
    var cur = document.documentElement.getAttribute('data-theme');
    var dark = cur === 'dark' || (!cur && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var next = dark ? 'light' : 'dark'; store.set('ghilaf-theme', next); G.theme(next);
  };

  // الشريط العلوي
  G.header = function (active, user) {
    var h = document.getElementById('hdr');
    var links = [['/dashboard.html#apps', 'تطبيقاتي', 'apps'], ['/dashboard.html#new', 'تطبيق جديد', 'new'], ['/dashboard.html#plan', 'الاشتراك', 'plan']];
    if (user && user.role === 'admin') links.push(['/admin.html', 'الإدارة', 'admin']);
    h.innerHTML = '<div class="wrap"><a class="brand" href="/"><b><svg class="i" viewBox="0 0 24 24"><path d="M12 3l8 4.500v9L12 21l-8-4.500v-9L12 3zM4 7.500l8 4.500 8-4.500M12 12v9"/></svg></b>غلاف</a>' +
      '<nav class="nav" aria-label="التنقل">' + links.map(function (l) {
        return '<a href="' + l[0] + '"' + (l[2] === active ? ' aria-current="page"' : '') + '>' + l[1] + '</a>';
      }).join('') + '</nav>' +
      '<div class="who"><span class="nm">' + G.esc(user ? user.name : '') + '</span>' +
      '<button class="btn sm" id="hTheme" type="button">الوضع</button>' +
      '<button class="btn sm" id="hOut" type="button">تسجيل الخروج</button></div></div>';
    document.getElementById('hTheme').onclick = G.toggleTheme;
    document.getElementById('hOut').onclick = function () {
      G.api('/auth/logout', { method: 'POST', body: {} }).then(function () { location.href = '/'; }, function () { location.href = '/'; });
    };
  };

  G.me = function () {
    return G.api('/auth/me').then(function (r) { return r.user; });
  };

  G.modal = function (html) {
    var m = document.createElement('div'); m.className = 'modal';
    m.innerHTML = '<div class="dlg" role="dialog" aria-modal="true">' + html + '</div>';
    document.body.appendChild(m);
    var close = function () { m.remove(); document.removeEventListener('keydown', esc); };
    var esc = function (e) { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', esc);
    m.addEventListener('mousedown', function (e) { if (e.target === m) close(); });
    var f = m.querySelector('input,select,button'); if (f) f.focus();
    return { el: m.firstChild, close: close };
  };
})();
