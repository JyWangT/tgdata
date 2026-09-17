/* 讓靜態網頁跟 Apps Script 說話。介面跟 google.script.run 一樣，所以頁面程式碼不用改。
 * 先試 POST（快），被瀏覽器跨網域規則擋住就自動改用 JSONP（一定通）。 */
(function () {
  var MODE = null;
  try { MODE = sessionStorage.getItem('apimode') || null; } catch (e) {}

  function runner() {
    var ok = function () {}, fail = function (e) { console.error(e); };
    var r = {
      withSuccessHandler: function (f) { ok = f; return r; },
      withFailureHandler: function (f) { fail = f; return r; },
      call:   function (token, fn, args) { transport({op:'call', token:token, fn:fn, args:args || []}, ok, fail); },
      login:  function (u, p)            { transport({op:'login', username:u, password:p}, ok, fail); },
      logout: function (t)               { transport({op:'logout', token:t}, ok, fail); }
    };
    return r;
  }

  function transport(body, ok, fail) {
    if (!window.API_URL || !/^https?:\/\//.test(window.API_URL)) {
      fail(new Error('config.js 裡的 API_URL 還沒填（要填 Apps Script 的 /exec 網址）'));
      return;
    }
    if (MODE === 'jsonp') return jsonp(body, ok, fail);

    fetch(window.API_URL, {
      method: 'POST',
      headers: {'Content-Type': 'text/plain;charset=utf-8'},
      body: JSON.stringify(body),
      redirect: 'follow'
    })
    .then(function (res) { return res.json(); })
    .then(function (j) {
      setMode('post');
      if (j && j.__error) fail(new Error(j.__error)); else ok(j ? j.result : null);
    })
    .catch(function () {
      if (MODE === null) { setMode('jsonp'); jsonp(body, ok, fail); }
      else fail(new Error('連不上後端'));
    });
  }

  function setMode(m) { MODE = m; try { sessionStorage.setItem('apimode', m); } catch (e) {} }

  var seq = 0;
  function jsonp(body, ok, fail) {
    var name = '__cb' + (++seq) + '_' + Date.now();
    var url = window.API_URL + (window.API_URL.indexOf('?') < 0 ? '?' : '&') +
              'callback=' + name + '&q=' + encodeURIComponent(JSON.stringify(body));
    if (url.length > 7500) { fail(new Error('內容太長，請縮短後再送出')); return; }

    var s = document.createElement('script');
    var done = false;
    var timer = setTimeout(function () { finish(); fail(new Error('後端沒有回應（請確認部署的「誰可以存取」是「所有人」）')); }, 30000);

    window[name] = function (j) {
      done = true; clearTimeout(timer); finish();
      if (j && j.__error) fail(new Error(j.__error)); else ok(j ? j.result : null);
    };
    function finish() { try { delete window[name]; } catch (e) { window[name] = undefined; }
                        if (s.parentNode) s.parentNode.removeChild(s); }
    s.onerror = function () { if (done) return; clearTimeout(timer); finish();
                              fail(new Error('連不上後端（網址錯誤，或部署未設為「所有人」）')); };
    s.src = url;
    document.head.appendChild(s);
  }

  window.google = { script: {} };
  Object.defineProperty(window.google.script, 'run', { get: runner });

  window.lsGet = function (k) { try { var v = localStorage.getItem('c:' + k); return v ? JSON.parse(v) : null; } catch (e) { return null; } };
  window.lsSet = function (k, v) { try { localStorage.setItem('c:' + k, JSON.stringify(v)); } catch (e) {} };
})();
