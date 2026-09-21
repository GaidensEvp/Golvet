
<script>
(function(){
  var WISH_ENDPOINT = "https://formspree.io/f/mnpndddz";
  var MIN = 10, MAX = 200;
  var LS_LAST = "golvet_wish_last";

  var form = document.getElementById("wishForm");
  if (!form) return;
  var text = document.getElementById("wishText");
  var num = document.getElementById("wishNum");
  var hint = document.getElementById("wishHint");
  var msg = document.getElementById("wishMsg");
  var submit = document.getElementById("wishSubmit");
  var done = document.getElementById("wishDone");
  var echo = document.getElementById("wishEcho");

  function sentRecently(){
    try { return Date.now() - Number(localStorage.getItem(LS_LAST) || 0) < 30000; } catch (e) { return false; }
  }
  function markSent(){
    try { localStorage.setItem(LS_LAST, String(Date.now())); } catch (e) {}
  }

  function clean(s){
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
  }
  text.addEventListener("input", function(){ msg.textContent = ""; msg.className = "wish-msg"; updateCount(); });

  function fail(t, field){
    msg.textContent = t;
    msg.className = "wish-msg err";
    (field || text).focus();
  }

  form.addEventListener("submit", function(e){
    e.preventDefault();
    if (document.getElementById("wishWeb").value) return; // botfälla
    if (sentRecently()) return fail("Vänta en liten stund innan du skickar nästa.");
    var t = clean(text.value);
    if (t.length < MIN) return fail("Skriv lite mer, minst " + MIN + " tecken.");
    if (t.length > MAX) return fail("Det blev för långt, högst " + MAX + " tecken.");
    var mailEl = document.getElementById("wishMail");
    var mail = mailEl.value.trim();
    if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return fail("E-postadressen ser inte riktig ut.", mailEl);
    var name = clean(document.getElementById("wishName").value).slice(0, 30);
    var payload = {
      _subject: "Golvet: nytt önskemål",
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

    fetch(WISH_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(payload)
    }).then(function(r){
      if (!r.ok) throw new Error("http " + r.status);
      markSent();
      echo.textContent = t + (payload.owns ? "  (du har uppgett att du äger aktier i bolaget)" : "");
      form.hidden = true;
      done.hidden = false;
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
})();
</script>
