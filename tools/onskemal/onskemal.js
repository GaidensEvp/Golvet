
<script>
(function(){
  // Prototyp: utan WISH_ENDPOINT sparas allt bara i den här webbläsaren (localStorage).
  var WISH_ENDPOINT = "";
  var MIN = 10, MAX = 200;
  var LS_VOTES = "golvet_wish_votes", LS_OWN = "golvet_wish_own";

  var form = document.getElementById("wishForm");
  if (!form) return;
  var text = document.getElementById("wishText");
  var num = document.getElementById("wishNum");
  var hint = document.getElementById("wishHint");
  var msg = document.getElementById("wishMsg");
  var submit = document.getElementById("wishSubmit");
  var done = document.getElementById("wishDone");
  var echo = document.getElementById("wishEcho");
  var echoNote = document.getElementById("wishEchoNote");
  var list = document.getElementById("wishList");

  var seed = [
    { id:"s1", text:"Vad är hett inom amerikanska REITs just nu?", by:"en medlem", votes:14, next:true },
    { id:"s2", text:"Hur påverkas de svenska bankerna av Riksbankens nästa besked?", by:"Anna", votes:9 },
    { id:"s3", text:"Är kärnkraft på väg att bli en börstrend i Norden?", by:"en medlem", votes:6 }
  ];

  function load(key){
    try { var v = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  }
  function save(key, val){
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  var votes = load(LS_VOTES);
  var own = load(LS_OWN);

  function el(tag, cls, txt){
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }

  function renderList(){
    list.textContent = "";
    var all = own.concat(seed).slice();
    all.forEach(function(w){
      var mine = votes.indexOf(w.id) !== -1;
      var count = w.votes + (mine ? 1 : 0);
      var li = el("li", "wish-item");
      var btn = el("button", "wish-vote");
      btn.type = "button";
      btn.setAttribute("aria-pressed", mine ? "true" : "false");
      btn.setAttribute("aria-label", (mine ? "Ta bort din röst: " : "Rösta på: ") + w.text);
      btn.appendChild(el("span", null, "▲"));
      btn.appendChild(el("b", null, String(count)));
      btn.addEventListener("click", function(){
        var i = votes.indexOf(w.id);
        if (i === -1) votes.push(w.id); else votes.splice(i, 1);
        save(LS_VOTES, votes);
        renderList();
      });
      var body = el("div", "wish-item-body");
      body.appendChild(el("p", null, w.text));
      var meta = el("div", "wish-meta");
      if (w.next) meta.appendChild(el("span", "wish-status next", "Nästa körning"));
      else if (w.mine) meta.appendChild(el("span", "wish-status", "Ditt förslag"));
      meta.appendChild(document.createTextNode("önskat av " + w.by));
      body.appendChild(meta);
      li.appendChild(btn);
      li.appendChild(body);
      list.appendChild(li);
    });
  }

  function clean(s){
    // ren text: kontrolltecken bort, blanksteg ihop
    var o = "";
    for (var k = 0; k < s.length; k++) {
      var c = s.charCodeAt(k);
      o += (c < 32 || c === 127) ? " " : s.charAt(k);
    }
    return o.replace(/ +/g, " ").trim();
  }

  function updateCount(){
    var n = clean(text.value).length;
    num.textContent = n + " / " + MAX;
    num.className = n > MAX ? "over" : "";
    hint.textContent = n < MIN ? "Minst " + MIN + " tecken" : "";
    hint.className = "";
  }
  text.addEventListener("input", function(){ msg.textContent = ""; msg.className = "wish-msg"; updateCount(); });

  function fail(t){
    msg.textContent = t;
    msg.className = "wish-msg err";
    text.focus();
  }

  form.addEventListener("submit", function(e){
    e.preventDefault();
    if (document.getElementById("wishWeb").value) return; // botfälla
    var t = clean(text.value);
    if (t.length < MIN) return fail("Skriv lite mer, minst " + MIN + " tecken.");
    if (t.length > MAX) return fail("Det blev för långt, högst " + MAX + " tecken.");
    var mail = document.getElementById("wishMail").value.trim();
    if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
      msg.textContent = "E-postadressen ser inte riktig ut.";
      msg.className = "wish-msg err";
      document.getElementById("wishMail").focus();
      return;
    }
    var name = clean(document.getElementById("wishName").value).slice(0, 30);
    var payload = {
      text: t,
      type: (form.querySelector("input[name=wishType]:checked") || {}).value || "tema",
      name: name,
      email: mail,
      owns: document.getElementById("wishConflict").checked,
      sent: new Date().toISOString()
    };

    submit.disabled = true;
    msg.textContent = "Skickar…";
    msg.className = "wish-msg";

    var send = WISH_ENDPOINT
      ? fetch(WISH_ENDPOINT, { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify(payload) })
          .then(function(r){ if (!r.ok) throw new Error("http " + r.status); })
      : Promise.resolve();

    send.then(function(){
      var w = { id:"m" + Date.now(), text:t, by:name || "en medlem", votes:0, mine:true };
      own.unshift(w);
      votes.push(w.id);
      save(LS_OWN, own.slice(0, 5));
      save(LS_VOTES, votes);
      echo.textContent = t + (payload.owns ? "  (du har uppgett att du äger aktier i bolaget)" : "");
      echoNote.textContent = WISH_ENDPOINT
        ? "Det är skickat. Tryck på pilen vid önskemål du själv vill ha besvarade."
        : "Det här är en prototyp: önskemålet sparas bara i din webbläsare, och inget har skickats till någon. Det syns bland exemplen här bredvid.";
      form.hidden = true;
      done.hidden = false;
      renderList();
    }).catch(function(){
      fail("Det gick inte att skicka just nu. Försök igen om en stund.");
    }).then(function(){
      submit.disabled = false;
    });
  });

  document.getElementById("wishAgain").addEventListener("click", function(){
    form.reset();
    updateCount();
    msg.textContent = "";
    form.hidden = false;
    done.hidden = true;
    text.focus();
  });

  updateCount();
  renderList();
})();
</script>
