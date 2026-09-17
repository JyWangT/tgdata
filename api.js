/* 讓靜態網頁跟 Apps Script 說話。介面跟 google.script.run 一樣，所以頁面程式碼不用改。
 *
 * 兩條路：
 *   1. POST（快，但會被瀏覽器的跨網域規則擋，視你的部署設定而定）
 *   2. JSONP（用 <script> 載入，不受 CORS 限制，一定會通）
 * 第一次呼叫時自動測試，哪條通就固定用哪條。
 */
(function () {
  var MODE = null;                      // null 未知 / 'post' / 'jsonp'
  try { MODE = sessionStorage.getItem('apimode') || null; } catch (e) {}

  function runner() {
    var ok = function () {}, fail = function (e) { console.error(e); };
    var r = {
      withSuccessHandler: function (f) { ok = f; return r; },
      withFailureHandler: function (f) { fail = f; return r; },
      call:   function (token, fn, args) { send({op:'call', token:token, fn:fn, args:args || []}); },
      login:  function (u, p)            { send({op:'login', username:u, password:p}); },
      logout: function (t)               { send({op:'logout', token:t}); }
    };
    function send(body) { transport(body, ok, fail); }
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
      headers: {'Content-Type': 'text/plain;charset=utf-8'},  // text/plain 不會觸發預檢
      body: JSON.stringify(body),
      redirect: 'follow'
    })
    .then(function (res) { return res.json(); })
    .then(function (j) {
      setMode('post');
      if (j && j.__error) fail(new Error(j.__error)); else ok(j ? j.result : null);
    })
    .catch(function () {
      if (MODE === null) { setMode('jsonp'); jsonp(body, ok, fail); }   // POST 被擋 → 改走 JSONP
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

  /* ---- 圖片上傳：用隱藏表單送出（不受 CORS 限制），再用 JSONP 輪詢取結果 ---- */
  window.uploadImage = function (file, token, onDone, onFail, onProgress) {
    if (!/^image\//.test(file.type)) { onFail(new Error('只支援圖片檔（PNG / JPG）')); return; }
    if (file.size > 5 * 1024 * 1024)  { onFail(new Error('圖片超過 5MB，請先壓縮')); return; }

    var reader = new FileReader();
    reader.onerror = function () { onFail(new Error('讀取檔案失敗')); };
    reader.onload = function () {
      var uploadId = 'u' + Date.now() + Math.random().toString(36).slice(2, 8);
      var iframeName = 'up_' + uploadId;

      var ifr = document.createElement('iframe');
      ifr.name = iframeName; ifr.style.display = 'none';
      document.body.appendChild(ifr);

      var form = document.createElement('form');
      form.method = 'POST'; form.action = window.API_URL; form.target = iframeName;
      form.enctype = 'application/x-www-form-urlencoded'; form.style.display = 'none';
      [['op','upload'], ['token', token], ['uploadId', uploadId],
       ['filename', file.name], ['mime', file.type], ['data', String(reader.result)]]
        .forEach(function (kv) {
          var i = document.createElement('input');
          i.type = 'hidden'; i.name = kv[0]; i.value = kv[1]; form.appendChild(i);
        });
      document.body.appendChild(form);
      form.submit();

      // 送出後讀不到回應（跨網域），所以每 2 秒問一次「好了沒」
      var tries = 0;
      var poll = setInterval(function () {
        tries++;
        if (onProgress) onProgress(tries);
        if (tries > 30) { clearInterval(poll); cleanup(); onFail(new Error('上傳逾時，請再試一次或改貼 Drive 連結')); return; }
        window.google.script.run
          .withSuccessHandler(function (info) {
            if (!info) return;                       // 還沒好，繼續等
            clearInterval(poll); cleanup(); onDone(info);
          })
          .withFailureHandler(function () {})
          .call(token, 'getUpload', [uploadId]);
      }, 2000);

      function cleanup() {
        setTimeout(function () {
          if (form.parentNode) form.parentNode.removeChild(form);
          if (ifr.parentNode) ifr.parentNode.removeChild(ifr);
        }, 500);
      }
    };
    reader.readAsDataURL(file);
  };

  window.google = { script: {} };
  Object.defineProperty(window.google.script, 'run', { get: runner });

  /* 瀏覽器端快取：先顯示上次的資料，背景再更新 */
  window.lsGet = function (k) { try { var v = localStorage.getItem('c:' + k); return v ? JSON.parse(v) : null; } catch (e) { return null; } };
  window.lsSet = function (k, v) { try { localStorage.setItem('c:' + k, JSON.stringify(v)); } catch (e) {} };
})();
