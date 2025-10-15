
/*
 * DVD Library Pro Card – v0.2.0
 * Custom element: dvd-library-pro-card
 * - Vertical or Horizontal layout
 * - Configurable rows (horizontal) or columns (vertical)
 * - Choose which fields to show per tile (poster, title, year, imdb_id, barcode, box)
 * - Visual editor (Lovelace UI editor)
 * - No external deps, vanilla Web Components
 */

(function() {
  const CARD_VERSION = "0.2.0";
  const ELEMENT = "dvd-library-pro-card";

  // Register for UI Card Picker
  if (!window.customCards) window.customCards = [];
  window.customCards.push({
    type: ELEMENT,
    name: "DVD Library Pro Card",
    description: "Grid/strip of DVDs with Box badge and configurable fields (vertical/horizontal)",
    preview: true,
    documentationURL: "",
  });

  const DEFAULTS = {
    title: "DVD Library",
    orientation: "horizontal", // or "vertical"
    rows: 1,       // used for horizontal layout
    columns: 5,    // used for vertical layout
    max_items: 0,  // 0=all
    aspect_ratio: "2/3",
    show: {
      poster: true,
      title: true,
      year: true,
      imdb_id: false,
      barcode: false,
      box: true
    }
  };

  const STYLE = `
    :host { display:block; }
    .card { padding: 12px; }
    .header { display:flex; align-items:baseline; justify-content:space-between; margin-bottom: 8px; }
    .title { font-weight:600; font-size:16px; }
    .meta { color: var(--secondary-text-color); font-size:12px; }
    .controls { display:flex; gap:8px; margin: 6px 0 12px 0; }
    .search { flex:1; height:36px; padding:6px 10px; border-radius:6px; border:1px solid var(--divider-color);
              background: var(--card-background-color); color: var(--primary-text-color); }

    .grid { display:grid; gap:10px; }
    .tile { position:relative; border-radius:8px; overflow:hidden; background:#1114; border:1px solid var(--divider-color); display:flex; flex-direction:column; }
    .poster { width:100%; aspect-ratio: var(--aspect, 2/3); object-fit: cover; background: #1b1b1b; }
    .box-badge { position:absolute; top:6px; left:6px; background: var(--primary-color);
                 color: var(--text-primary-color, #fff); font-size:12px; font-weight:600; padding:2px 6px; border-radius:999px; box-shadow:0 1px 3px rgba(0,0,0,.4); }
    .caption { padding:8px; display:flex; flex-direction:column; gap:2px; }
    .name { font-size:14px; font-weight:600; line-height:1.2; }
    .sub { font-size:12px; color: var(--secondary-text-color); }
    .empty { text-align:center; padding: 24px 8px; color: var(--secondary-text-color); }
  `;

  function deepMerge(target, src){
    const out = JSON.parse(JSON.stringify(target));
    function _merge(t, s){
      for(const k of Object.keys(s||{})){
        if (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k])){
          if (!t[k] || typeof t[k] !== 'object') t[k] = {};
          _merge(t[k], s[k]);
        } else {
          t[k] = s[k];
        }
      }
    }
    _merge(out, src||{}); return out;
  }

  function esc(s){
    if (s === null || s === undefined) return "";
    return String(s).replace(/[&<>"']/g, (c)=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  }
  function forceHttps(url){
    if (!url || typeof url !== 'string') return '';
    if (url.startsWith('http://')) return 'https://' + url.substring(7);
    return url;
  }
  const isInt = (v)=> typeof v === 'number' && Number.isInteger(v);

  class DvdLibraryProCard extends HTMLElement {
    constructor(){
      super();
      this._config = null;
      this._hass = null;
      this._root = this.attachShadow({mode:'open'});
      this._unsub = null;
      this._query = '';
    }

    set hass(hass){
      this._hass = hass;
      if (!this._config) return;
      this._ensureSubscribe();
      this._render();
    }

    setConfig(config){
      if (!config || !config.entity) throw new Error("Please set 'entity' (e.g., sensor.dvd_library)");
      this._config = deepMerge(DEFAULTS, config);
      this._query = '';
      this._render();
    }

    getCardSize(){ return 5; }

    _ensureSubscribe(){
      if (!this._hass || !this._config) return;
      if (!this._hass.connection || !this._hass.connection.subscribeEvents) return;
      if (this._unsub) return;
      this._hass.connection.subscribeEvents((ev)=>{
        try{
          const ent = ev && ev.data && ev.data.entity_id;
          if (ent === this._config.entity) this._render();
        } catch(e) {}
      }, 'state_changed').then((unsub)=>{ this._unsub = unsub; }).catch(()=>{});
    }

    _state(){
      return this._hass && this._config ? this._hass.states[this._config.entity] : undefined;
    }

    _items(){
      const st = this._state();
      const src = (st && Array.isArray(st.attributes?.items)) ? st.attributes.items : [];
      return src.map((it)=>({
        title: it.title || '',
        year: it.year || '',
        poster: it.poster || '',
        imdb_id: it.imdb_id || '',
        barcode: it.barcode || '',
        box: (typeof it.box === 'string' && /^\d+$/.test(it.box)) ? parseInt(it.box,10) : (Number.isInteger(it.box) ? it.box : null),
      }));
    }

    _render(){
      const cfg = this._config || DEFAULTS;
      const st = this._state();
      const count = st?.state ?? 0;
      const list = this._items();

      // Search filter
      const q = (this._query||'').toLowerCase().trim();
      const filtered = q ? list.filter(i=> (i.title||'').toLowerCase().includes(q)) : list;
      const max = Number(cfg.max_items)||0;
      const view = max>0 ? filtered.slice(0, max) : filtered;

      // Layout template
      const aspect = cfg.aspect_ratio || '2/3';

      const card = document.createElement('ha-card');
      card.className = 'card';

      const style = document.createElement('style');
      style.textContent = STYLE;
      card.appendChild(style);

      // Header
      const header = document.createElement('div');
      header.className = 'header';
      header.innerHTML = `<div class="title">${esc(cfg.title)}</div><div class="meta">${esc(count)} items</div>`;
      card.appendChild(header);

      // Controls
      const ctr = document.createElement('div');
      ctr.className = 'controls';
      ctr.innerHTML = `<input class="search" placeholder="Search title..." value="${esc(this._query)}" />`;
      ctr.querySelector('.search').addEventListener('input', (e)=>{ this._query = String(e.target.value||''); this._render(); });
      card.appendChild(ctr);

      // Grid wrapper
      const grid = document.createElement('div');
      grid.className = 'grid';
      grid.style.setProperty('--aspect', aspect);

      // Orientation sizing
      if ((cfg.orientation||'horizontal') === 'horizontal'){
        const rows = Math.max(1, Number(cfg.rows)||1);
        grid.style.gridAutoFlow = 'column';
        grid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
        grid.style.gridAutoColumns = 'minmax(140px, 1fr)';
      } else { // vertical
        const cols = Math.max(1, Number(cfg.columns)||4);
        grid.style.gridTemplateColumns = `repeat(${cols}, minmax(140px, 1fr))`;
      }

      // Render items
      if (!view.length){
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = q ? 'No matches' : 'No items';
        card.appendChild(empty);
      } else {
        for (const it of view){
          const tile = document.createElement('div');
          tile.className = 'tile';

          // Poster
          if (cfg.show.poster){
            const img = document.createElement('img');
            img.className = 'poster';
            img.loading = 'lazy'; img.decoding='async'; img.referrerPolicy='no-referrer';
            const url = forceHttps(it.poster);
            img.src = url || "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='320' height='480'><rect width='100%' height='100%' fill='%23222222'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='%23888888' font-size='18'>No Poster</text></svg>";
            tile.appendChild(img);
          }

          // Box badge
          if (cfg.show.box && isInt(it.box)){
            const badge = document.createElement('div');
            badge.className = 'box-badge';
            badge.textContent = `Box ${it.box}`;
            tile.appendChild(badge);
          }

          // Caption
          if (cfg.show.title || cfg.show.year || cfg.show.imdb_id || cfg.show.barcode){
            const caption = document.createElement('div');
            caption.className = 'caption';
            if (cfg.show.title){
              const year = (cfg.show.year && it.year) ? ` (${esc(it.year)})` : '';
              const nm = document.createElement('div');
              nm.className = 'name';
              nm.title = it.title || '';
              nm.innerHTML = `${esc(it.title)}${year}`;
              caption.appendChild(nm);
            }
            if (cfg.show.imdb_id || cfg.show.barcode){
              const sub = document.createElement('div');
              sub.className = 'sub';
              if (cfg.show.imdb_id && it.imdb_id){ sub.innerHTML = `IMDb: ${esc(it.imdb_id)}`; }
              else if (cfg.show.barcode && it.barcode){ sub.innerHTML = `Barcode: ${esc(it.barcode)}`; }
              else { sub.innerHTML = '&nbsp;'; }
              caption.appendChild(sub);
            }
            tile.appendChild(caption);
          }

          grid.appendChild(tile);
        }
        card.appendChild(grid);
      }

      // Attach/replace
      if (!this._card){ this._card = card; this._root.innerHTML = ''; this._root.appendChild(this._card); }
      else { this._root.replaceChild(card, this._card); this._card = card; }
    }

    // Visual editor element
    static getConfigElement(){ return document.createElement('dvd-library-pro-card-editor'); }
    static getStubConfig(){ return { entity: 'sensor.dvd_library', title: 'DVD Library' }; }
  }

  // ---- Visual Editor ----
  class DvdLibraryProCardEditor extends HTMLElement {
    constructor(){
      super();
      this._config = null;
      this._shadow = this.attachShadow({mode:'open'});
    }
    setConfig(config){
      this._config = deepMerge(DEFAULTS, config || {});
      this._render();
    }
    set hass(h){ this._hass = h; }

    _emitChanged(){
      const event = new Event('config-changed', { bubbles: true, composed: true });
      event.detail = { config: this._config };
      this.dispatchEvent(event);
    }

    _bool(id){ return this._config.show[id] ? true : false; }

    _render(){
      const c = this._config || DEFAULTS;
      const html = `
        <style>
          .ed { padding: 8px; display:grid; gap:10px; }
          .row { display:grid; grid-template-columns: 150px 1fr; align-items:center; gap:8px; }
          .group { border: 1px solid var(--divider-color); border-radius: 8px; padding: 8px; }
          .group h4 { margin: 0 0 6px 0; font-size: 13px; color: var(--secondary-text-color); }
          input[type="text"], select, ha-textfield { width: 100%; }
          .cols { display:grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap:8px; }
          label { font-size: 13px; }
        </style>
        <div class="ed">
          <div class="row">
            <label>Entity</label>
            <ha-entity-picker .hass=${'__hass__'} .value="${c.entity || ''}" .includeDomains=${JSON.stringify(['sensor'])}></ha-entity-picker>
          </div>
          <div class="row">
            <label>Title</label>
            <input id="title" type="text" value="${esc(c.title)}"/>
          </div>
          <div class="row">
            <label>Orientation</label>
            <select id="orientation">
              <option value="horizontal" ${c.orientation==='horizontal'?'selected':''}>Horizontal (rows)</option>
              <option value="vertical" ${c.orientation==='vertical'?'selected':''}>Vertical (columns)</option>
            </select>
          </div>
          <div class="row">
            <label>Rows (horizontal)</label>
            <input id="rows" type="number" min="1" value="${Number(c.rows)||1}"/>
          </div>
          <div class="row">
            <label>Columns (vertical)</label>
            <input id="columns" type="number" min="1" value="${Number(c.columns)||5}"/>
          </div>
          <div class="row">
            <label>Max items (0 = all)</label>
            <input id="max_items" type="number" min="0" value="${Number(c.max_items)||0}"/>
          </div>
          <div class="row">
            <label>Poster aspect ratio</label>
            <input id="aspect_ratio" type="text" value="${esc(c.aspect_ratio||'2/3')}" placeholder="e.g. 2/3 or 16/9"/>
          </div>

          <div class="group">
            <h4>Show fields</h4>
            <div class="cols">
              <label><input id="show_poster" type="checkbox" ${c.show.poster?'checked':''}/> Poster</label>
              <label><input id="show_title" type="checkbox" ${c.show.title?'checked':''}/> Title</label>
              <label><input id="show_year" type="checkbox" ${c.show.year?'checked':''}/> Year</label>
              <label><input id="show_imdb" type="checkbox" ${c.show.imdb_id?'checked':''}/> IMDb ID</label>
              <label><input id="show_barcode" type="checkbox" ${c.show.barcode?'checked':''}/> Barcode</label>
              <label><input id="show_box" type="checkbox" ${c.show.box?'checked':''}/> Box badge</label>
            </div>
          </div>
        </div>`;

      this._shadow.innerHTML = html;

      // Wire inputs
      const set = (id, fn)=>{ const el = this._shadow.getElementById(id); if (el) el.addEventListener('change', fn); };

      // entity via ha-entity-picker (wired separately by HA when editor is hosted)
      const ep = this._shadow.querySelector('ha-entity-picker');
      if (ep){
        try { ep.hass = this._hass; } catch(e){}
        ep.addEventListener('value-changed', (e)=>{ this._config.entity = e.detail.value; this._emitChanged(); });
      }

      set('title', (e)=>{ this._config.title = e.target.value; this._emitChanged(); });
      set('orientation', (e)=>{ this._config.orientation = e.target.value; this._emitChanged(); });
      set('rows', (e)=>{ this._config.rows = Math.max(1, Number(e.target.value||1)); this._emitChanged(); });
      set('columns', (e)=>{ this._config.columns = Math.max(1, Number(e.target.value||1)); this._emitChanged(); });
      set('max_items', (e)=>{ this._config.max_items = Math.max(0, Number(e.target.value||0)); this._emitChanged(); });
      set('aspect_ratio', (e)=>{ this._config.aspect_ratio = e.target.value || '2/3'; this._emitChanged(); });

      const bool = (id, key)=> set(id, (e)=>{ this._config.show[key] = !!e.target.checked; this._emitChanged(); });
      bool('show_poster','poster');
      bool('show_title','title');
      bool('show_year','year');
      bool('show_imdb','imdb_id');
      bool('show_barcode','barcode');
      bool('show_box','box');
    }
  }

  // Register custom elements
  if (!customElements.get(ELEMENT)) customElements.define(ELEMENT, DvdLibraryProCard);
  if (!customElements.get('dvd-library-pro-card-editor')) customElements.define('dvd-library-pro-card-editor', DvdLibraryProCardEditor);

})();
