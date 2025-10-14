// DVD Library Card – v0.1.1
// Element name: dvd-library-card
// Plain JS, safe across browsers.
// - Auto-refresh via state_changed
// - Render posters as <img> (HTTPS upgrade + fallback)
// - Owner/Admin Delete and Add DVD modal (requires at least IMDb ID or Title or Barcode)

(function() {
  console.log("dvd-library-card: script loaded v0.1.1");

  function esc(s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/[&<>"']/g, function(c) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }

  class DvdLibraryCard extends HTMLElement {
    constructor() {
      super();
      this._config = null;
      this._hass = null;
      this._card = null;
      this._search = "";
      this._isPriv = null;   // owner/admin resolved via WS once
      this._userName = "";
      this._unsub = null;    // unsubscribe to state_changed
    }

    connectedCallback() { this._ensureSubscribe(); }

    disconnectedCallback() {
      if (this._unsub) { try { this._unsub(); } catch(e){} this._unsub = null; }
    }

    set hass(hass) {
      this._hass = hass;
      if (!this._config) return;

      // Resolve current user: owner/admin + display name
      if (this._isPriv === null && this._hass && this._hass.callWS) {
        var self = this;
        this._hass.callWS({ type: "auth/current_user" })
          .then(function(user) {
            self._isPriv = !!(user && (user.is_admin || user.is_owner));
            self._userName = (user && (user.name || user.username)) ? (user.name || user.username) : "";
            self._render();
          })
          .catch(function() {
            self._isPriv = false;
            self._render();
          });
      }

      this._ensureSubscribe();
      this._render();
    }

    setConfig(config) {
      if (!config.entity) throw new Error("Please set 'entity' (sensor.dvd_library)");
      // Optional: show_add | show_delete: "auto" | "always" | "never"
      this._config = { title: "DVD Library", show_add: "auto", show_delete: "auto", ...config };
      this._search = "";
      this._render();
    }

    getCardSize() { return 5; }

    _ensureSubscribe() {
      var self = this;
      if (!this._hass || !this._config) return;
      if (!this._hass.connection || !this._hass.connection.subscribeEvents) return;
      if (this._unsub) return;

      this._hass.connection.subscribeEvents(function(ev) {
        try {
          var ent = ev && ev.data && ev.data.entity_id;
          if (ent === self._config.entity) self._render();
        } catch (e) {}
      }, "state_changed").then(function(unsub) {
        self._unsub = unsub;
        console.log("dvd-library-card: subscribed to state_changed for", self._config.entity);
      }).catch(function(e) {
        console.warn("dvd-library-card: subscribeEvents failed", e);
      });
    }

    _filter(items) {
      var q = (this._search || "").toLowerCase().trim();
      if (!q) return items;
      return items.filter(function(it) {
        var parts = [];
        if (it.title) parts.push(String(it.title));
        if (it.year) parts.push(String(it.year));
        if (it.imdb_id) parts.push(String(it.imdb_id));
        if (it.barcode) parts.push(String(it.barcode));
        if (it.genres) parts.push(String(it.genres));
        if (it.director) parts.push(String(it.director));
        if (it.actors) parts.push(String(it.actors));
        return parts.join(" ").toLowerCase().indexOf(q) !== -1;
      });
    }

    _showAdd() {
      var m = this._config.show_add;
      if (m === "always") return true;
      if (m === "never") return false;
      return !!this._isPriv;
    }

    _showDelete() {
      var m = this._config.show_delete;
      if (m === "always") return true;
      if (m === "never") return false;
      return !!this._isPriv;
    }

    _delete(it) {
      var self = this;
      var title = it.title || "(Untitled)";
      var year  = it.year ? (" (" + it.year + ")") : "";
      if (!confirm('Delete "' + title + year + '"?')) return;

      var data = {};
      if (it.imdb_id) data.imdb_id = it.imdb_id;
      else if (it.barcode) data.barcode = it.barcode;
      else if (it.title) data.title = it.title;

      function removeIndex() {
        if (typeof it.__index === "number") {
          self._hass.callService("dvd_library", "remove_index", { index: it.__index })
            .catch(function(e){ console.error("dvd-library-card: remove_index failed", e); alert("Failed to remove (index)."); });
        } else {
          alert("No identifiers or index; cannot remove.");
        }
      }

      if (Object.keys(data).length > 0) {
        this._hass.callService("dvd_library", "remove_item", data)
          .catch(function(e){ console.warn("dvd-library-card: remove_item failed, trying index", e); removeIndex(); });
      } else {
        removeIndex();
      }
    }

    _openAddModal() {
      var ov = this._card.querySelector(".dlg-overlay");
      if (!ov) return;
      ov.style.display = "flex";

      var who = this._card.querySelector("#add_added_by");
      if (who && !who.value && this._userName) who.value = this._userName;

      var first = this._card.querySelector("#add_imdb_id") || this._card.querySelector("#add_title");
      if (first) first.focus();
    }

    _closeAddModal() {
      var ov = this._card.querySelector(".dlg-overlay");
      if (ov) ov.style.display = "none";
      ["#add_imdb_id","#add_title","#add_year","#add_barcode"].forEach((sel)=>{
        var el = this._card.querySelector(sel);
        if (el) el.value = "";
      });
    }

    _submitAdd() {
      var imdb = ((this._card.querySelector("#add_imdb_id")||{}).value || "").trim();
      var title = ((this._card.querySelector("#add_title")||{}).value || "").trim();
      var year  = ((this._card.querySelector("#add_year")||{}).value || "").trim();
      var ean   = ((this._card.querySelector("#add_barcode")||{}).value || "").trim();
      var who   = ((this._card.querySelector("#add_added_by")||{}).value || "").trim();

      if (!imdb && !title && !ean) {
        alert("Please fill at least one of: IMDb ID, Title, or Barcode.");
        return;
      }

      var payload = {};
      if (imdb) payload.imdb_id = imdb;
      if (title) payload.title = title;
      if (year)  payload.year = year;
      if (ean)   payload.barcode = ean;
      if (who)   payload.added_by = who;

      var btn = this._card.querySelector("#add_submit_btn");
      if (btn) { btn.disabled = true; btn.textContent = "Adding..."; }

      var self = this;
      this._hass.callService("dvd_library", "add_item", payload)
        .then(function(){ self._closeAddModal(); self._render(); })
        .catch(function(e){ console.error("dvd-library-card: add_item failed", e); alert("Failed to add DVD. Check logs."); })
        .finally(function(){ if (btn) { btn.disabled = false; btn.textContent = "Add"; } });
    }

    _render() {
      if (!this._hass || !this._config) return;

      var st = this._hass.states[this._config.entity];
      var items = (st && st.attributes && st.attributes.items) ? st.attributes.items : [];

      // Tag each with its original index for index-based deletion
      var indexed = items.map(function(it, idx){ var o={}; for (var k in it){o[k]=it[k];} o.__index=idx; return o; });
      var filtered = this._filter(indexed);
      var showAdd = this._showAdd();
      var showDel = this._showDelete();

      if (!this._card) { this._card = document.createElement("ha-card"); this.appendChild(this._card); }
      this._card.header = this._config.title || "DVD Library";

      var css = [
        '<style>',
        '.wrap{padding:12px;}',
        '.bar{display:flex;gap:12px;align-items:center;margin-bottom:12px;}',
        '.search{flex:1;padding:8px;border-radius:6px;border:1px solid var(--divider-color);background:var(--card-background-color);color:var(--primary-text-color);}',
        '.btnAdd{padding:8px 12px;border-radius:6px;border:1px solid var(--primary-color);background:var(--primary-color);color:#fff;cursor:pointer;}',
        '.btnAdd:hover{filter:brightness(0.95)}',
        '.count{min-width:120px;text-align:right;color:var(--secondary-text-color)}',
        '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;}',
        '.tile{position:relative;background:var(--card-background-color);border-radius:8px;box-shadow:var(--ha-card-box-shadow);overflow:hidden;border:1px solid var(--divider-color);}',
        '.poster{width:100%;height:240px;object-fit:cover;background:#222;display:block;}',
        '.meta{padding:8px;}',
        '.title{font-weight:600;margin-bottom:6px;}',
        '.dim{color:var(--secondary-text-color);font-size:0.88em;word-break:break-word;}',
        '.row{display:flex;justify-content:space-between;gap:6px;flex-wrap:wrap;}',
        '.admin{position:absolute;top:6px;right:6px;background:rgba(0,0,0,0.45);padding:4px;border-radius:6px;}',
        '.btn{background:transparent;border:none;color:#fff;cursor:pointer;font-size:18px;line-height:1;padding:4px 6px;border-radius:4px;}',
        '.btn:hover{background:rgba(255,255,255,0.12);}',

        /* Modal */
        '.dlg-overlay{display:none;position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.5);align-items:center;justify-content:center;}',
        '.dlg{width:100%;max-width:520px;background:var(--card-background-color);color:var(--primary-text-color);border-radius:10px;border:1px solid var(--divider-color);box-shadow:var(--ha-card-box-shadow);}',
        '.dlg header{padding:12px 16px;font-weight:600;border-bottom:1px solid var(--divider-color);} ',
        '.dlg .body{padding:12px 16px;display:grid;grid-template-columns:1fr 1fr;gap:12px;}',
        '.dlg .body .full{grid-column:1 / -1;}',
        '.dlg label{font-size:0.85em;color:var(--secondary-text-color);display:block;margin-bottom:4px;}',
        '.dlg input{width:100%;padding:8px;border-radius:6px;border:1px solid var(--divider-color);background:var(--card-background-color);color:var(--primary-text-color);} ',
        '.dlg footer{padding:12px 16px;border-top:1px solid var(--divider-color);display:flex;gap:12px;justify-content:flex-end;}',
        '.btnSecondary{padding:8px 12px;border-radius:6px;border:1px solid var(--divider-color);background:transparent;color:var(--primary-text-color);cursor:pointer;}',
        '.btnPrimary{padding:8px 12px;border-radius:6px;border:1px solid var(--primary-color);background:var(--primary-color);color:#fff;cursor:pointer;}',
        '.btnPrimary[disabled]{opacity:0.7;cursor:not-allowed;}',
        '</style>'
      ].join("");

      var cards = filtered.map(function(raw){
        var it = {
          __index: raw.__index,
          title: raw.title || "",
          year: raw.year || "",
          imdb_id: raw.imdb_id || "",
          barcode: raw.barcode || "",
          runtime: raw.runtime || "",
          imdb_rating: raw.imdb_rating || "",
          poster: raw.poster || ""
        };

        var poster = (it.poster && it.poster !== "N/A") ? String(it.poster) : "";
        if (poster.indexOf("http://") === 0) poster = poster.replace(/^http:\/\//i, "https://");
        if (!poster) poster = "https://via.placeholder.com/300x450?text=No+Poster";

        var title = it.title || "(Untitled)";
        var year  = it.year  || "";
        var rating = (it.imdb_rating && it.imdb_rating !== "N/A") ? ("⭐ " + it.imdb_rating) : "";
        var runtime = (it.runtime && it.runtime !== "N/A") ? it.runtime : "";

        var id = "";
        if (it.imdb_id) id = it.imdb_id;
        else if (it.barcode) id = "EAN: " + it.barcode;
        var showId = id && !/^https?:\/\//i.test(id);

        return [
          '<div class="tile" data-index="', it.__index, '">',
            '<img class="poster" src="', esc(poster), '" alt="Poster for ', esc(title), '" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src=\'https://via.placeholder.com/300x450?text=No+Poster\';">',
            (showDel ? '<div class="admin"><button class="btn del" title="Delete">🗑️</button></div>' : ''),
            '<div class="meta">',
              '<div class="title">', esc(title), '</div>',
              '<div class="row">',
                '<div class="dim">', esc(year), (runtime ? ' • ' + esc(runtime) : ''), '</div>',
                '<div class="dim">', esc(rating), '</div>',
              '</div>',
              (showId ? ('<div class="dim">' + esc(id) + '</div>') : ''),
            '</div>',
          '</div>'
        ].join("");
      }).join("");

      var addBtn = showAdd ? '<button class="btnAdd" id="btnAddDvd">+ Add</button>' : '';
      var bar = [
        '<div class="bar">',
          '<input class="search" type="search" placeholder="Search title/ID/barcode" value="', esc(this._search || ""), '">',
          addBtn,
          '<div class="count">', String(filtered.length), '/', String(items.length), ' items</div>',
        '</div>'
      ].join("");

      var dlg = [
        '<div class="dlg-overlay" style="display:none">',
          '<div class="dlg">',
            '<header>Add DVD</header>',
            '<div class="body">',
              '<div class="full"><label>IMDb ID (tt...)</label><input id="add_imdb_id" type="text" placeholder="e.g., tt0133093"></div>',
              '<div><label>Title</label><input id="add_title" type="text" placeholder="e.g., The Matrix"></div>',
              '<div><label>Year (optional)</label><input id="add_year" type="text" placeholder="e.g., 1999"></div>',
              '<div class="full"><label>Barcode (optional)</label><input id="add_barcode" type="text" placeholder="e.g., 7321931145014"></div>',
              '<div class="full"><label>Added by (optional)</label><input id="add_added_by" type="text" placeholder="Your name"></div>',
              '<div class="full" style="color:var(--secondary-text-color);font-size:0.9em">Fill at least one of: <b>IMDb ID</b>, <b>Title</b>, or <b>Barcode</b>.</div>',
            '</div>',
            '<footer>',
              '<button class="btnSecondary" id="add_cancel_btn">Cancel</button>',
              '<button class="btnPrimary" id="add_submit_btn">Add</button>',
            '</footer>',
          '</div>',
        '</div>'
      ].join("");

      this._card.innerHTML = [
        css,
        '<div class="wrap">',
          bar,
          '<div class="grid">', cards, '</div>',
        '</div>',
        dlg
      ].join("");

      // Search
      var input = this._card.querySelector(".search");
      if (input) {
        var self = this;
        input.oninput = function(e){ self._search = e.target.value; self._render(); };
      }

      // Delete
      if (showDel) {
        var selfDel = this;
        Array.prototype.forEach.call(this._card.querySelectorAll(".tile .del"), function(btn){
          btn.addEventListener("click", function(ev){
            ev.stopPropagation();
            var tile = btn.closest(".tile");
            var idx = Number(tile.getAttribute("data-index"));
            var item = null;
            for (var i=0;i<filtered.length;i++){ if (filtered[i].__index === idx){ item = filtered[i]; break; } }
            if (!item) item = { __index: idx };
            selfDel._delete(item);
          });
        });
      }

      // Add modal
      if (showAdd) {
        var selfAdd = this;
        var btnAdd = this._card.querySelector("#btnAddDvd");
        if (btnAdd) btnAdd.addEventListener("click", function(){ selfAdd._openAddModal(); });
        var btnCancel = this._card.querySelector("#add_cancel_btn");
        if (btnCancel) btnCancel.addEventListener("click", function(){ selfAdd._closeAddModal(); });
        var btnSubmit = this._card.querySelector("#add_submit_btn");
        if (btnSubmit) btnSubmit.addEventListener("click", function(){ selfAdd._submitAdd(); });
        Array.prototype.forEach.call(this._card.querySelectorAll(".dlg input"), function(inp){
          inp.addEventListener("keydown", function(ev){
            if (ev.key === "Enter") { ev.preventDefault(); selfAdd._submitAdd(); }
          });
        });
      }
    }
  }

  if (!customElements.get("dvd-library-card")) {
    customElements.define("dvd-library-card", DvdLibraryCard);
    console.log("dvd-library-card: custom element defined");
  } else {
    console.log("dvd-library-card: element already defined");
  }

  // Show in the “Manual card” picker
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "dvd-library-card",
    name: "DVD Library Card",
    description: "Auto-refreshing DVD grid; posters; Owner/Admin Add & Delete."
  });
})();
