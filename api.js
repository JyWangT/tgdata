/* 讓網頁用 fetch 跟 Apps Script 說話，介面跟 google.script.run 一模一樣，頁面程式不用改 */
(function () {
  function runner() {
    var ok = function () {}, fail = function (e) { console.error(e); };
    var r = {
      withSuccessHandler: function (f) { ok = f; return r; },
      withFailureHandler: function (f) { fail = f; return r; },
      call:   function (token, fn, args) { post({op:'call', token:token, fn:fn, args:args || []}); },
      login:  function (u, p)            { post({op:'login', username:u, password:p}); },
      logout: function (t)               { post({op:'logout', token:t}); }
    };
    function post(body) {
      fetch(window.API_URL, {
        method: 'POST',
        headers: {'Content-Type': 'text/plain;charset=utf-8'},   // text/plain 不會觸發預檢，Apps Script 才收得到
        body: JSON.stringify(body),
        redirect: 'follow'
      })
      .then(function (res) { return res.json(); })
      .then(function (j) { if (j && j.__error) fail(new Error(j.__error)); else ok(j ? j.result : null); })
      .catch(function (e) { fail(new Error('連不上後端：' + e.message)); });
    }
    return r;
  }
  window.google = { script: {} };
  Object.defineProperty(window.google.script, 'run', { get: runner });

  /* 瀏覽器端快取：先顯示上次的資料，背景再更新（stale-while-revalidate） */
  window.lsGet = function (k) { try { var v = localStorage.getItem('c:' + k); return v ? JSON.parse(v) : null; } catch (e) { return null; } };
  window.lsSet = function (k, v) { try { localStorage.setItem('c:' + k, JSON.stringify(v)); } catch (e) {} };
})();