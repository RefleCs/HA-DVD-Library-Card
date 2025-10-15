
/*
 * DVD Library Pro Card – v0.4.0
 * Custom element: dvd-library-pro-card
 *
 * New in 0.4.0
 * - Tap/Hold actions: tap opens IMDb (if imdb_id), hold can Set box / Delete / None
 * - Inline Set Box dialog (prompt -> calls dvd_library.set_box)
 * - Per-box filter dropdown (shows only Box N)
 * - Keeps 0.3.0 features: orientation (horizontal/vertical), rows/columns, box badge, delete button, visual editor
 */
(function(){
  const ELEMENT = 'dvd-library-pro-card';
  const EDITOR  = 'dvd-library-pro-card-editor';
  const VERSION = '0.4.0';
  console.info(`%c${ELEMENT}%c v${VERSION}`,'color:#03a9f4;font-weight:700','color:unset');

  // Register for card picker
  window.customCards = window.customCards || [];
  window.customCards.push({ type: ELEMENT, name: 'DVD Library Pro Card', description: 'DVD grid with Box badge, filters, actions, and orientation control', preview: true });

  const DEFAULTS = {
    title: 'DVD Library',
    entity: 'sensor.dvd_library',
    orientation: 'horizontal', // 'horizontal' | 'vertical'
    rows: 2,            // used when orientation = horizontal
    columns: 5,         // used when orientation = vertical
    max_items: 0,       // 0 = no limit
    aspect_ratio: '2/3',
    allow_delete: 'auto', // 'auto' (admins/owners), 'always', 'never'
    show_filters: true,
    actions: { tap: 'imdb', hold: 'none' }, // tap: imdb|none, hold: set_box|delete|none
    show: { poster: true, title: true, year: true, imdb_id: false, barcode: false, box: true }
  };

  const STYLE = `
    :host { display:block; }
    .card { padding: 12px; }
    .header { display:flex; align-items:baseline; justify-content:space-between; margin-bottom: 8px; }
    .title { font-weight:600; font-size:16px; }
    .meta { color: var(--secondary-text-color); font-size:12px; }
    .controls { display:flex; gap:8px; margin: 6px 0 12px 0; flex-wrap: wrap; }
    .search { flex:1; min-width: 200px; height:36px; padding:6px 10px; border-radius:6px; border:1px solid var(--divider-color);
              background: var(--card-background-color); color: var(--primary-text-color); }
    .select { height:36px; padding:6px 8px; border-radius:6px; border:1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); }

    .grid-wrap { position:relative; }
    .grid { display:grid; gap:10px; }

    .tile { position:relative; border-radius:8px; overflow:hidden; background:#1114; border:1px solid var(--divider-color); display:flex; flex-direction:column; cursor: pointer; }
    .poster { width:100%; aspect-ratio: var(--aspect, 2/3); object-fit: cover; background: #1b1b1b; }
    .box-badge { position:absolute; top:6px; left:6px; background: var(--primary-color);
                 color: var(--text-primary-color, #fff); font-size:12px; font-weight:600; padding:2px 6px; border-radius:999px; box-shadow:0 1px 3px rgba(0,0,0,.4); }
    .delete { position:absolute; top:6px; right:6px; display:flex; align-items:center; justify-content:center;
              width:26px; height:26px; border-radius:50%; background: #0009; color:#fff; cursor:pointer; border:1px solid #fff3; }
    .delete:hover { background:#c62828; }

    .caption { padding:8px; display:flex; flex-direction:column; gap:2px; }
    .name { font-size:14px; font-weight:600; line-height:1.2; }
    .sub { font-size:12px; color: var(--secondary-text-color); }
    .empty { text-align:center; padding: 24px 8px; color: var(--secondary-text-color); }
  `;

  const esc = (s)=> (s===null||s===undefined) ? '' : String(s).replace(/[&<>"']/g, (c)=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  const forceHttps = (url)=> (!url || typeof url!=='string') ? '' : (url.startsWith('http://') ? ('https://'+url.substring(7)) : url);
  const toIntOrNull = (v)=> {
    if (v===null||v===undefined||v==='') return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  };

  class DvdLibraryProCard extends HTMLElement {
    constructor(){
      super();
      this._cfg = null;
      this._hass = null;
      this._shadow = this.attachShadow({mode:'open'});
      this._query = '';
      this._isPriv = null; // admin/owner
      this._boxFilter = 'all';
    }

    set hass(hass){
      this._hass = hass;
      if (!this._cfg) return;
      this._ensurePrivilege();
      this._render();
    }

    setConfig(config){
      if (!config || !config.entity) throw new Error("Please set 'entity' (e.g., sensor.dvd_library)");
      const d = JSON.parse(JSON.stringify(DEFAULTS));
      const merge = (t,s)=>{ for(const k in s){ if(s[k]&&typeof s[k]==='object'&&!Array.isArray(s[k])){ t[k]=t[k]||{}; merge(t[k],s[k]); } else t[k]=s[k]; } };
      merge(d, config);
      // normalize actions
      d.actions = Object.assign({}, DEFAULTS.actions, d.actions||{});
      this._cfg = d;
      this._query = '';
      this._render();
    }

    getCardSize(){ return 5; }
    static getConfigElement(){ return document.createElement(EDITOR); }
    static getStubConfig(){ return { entity: 'sensor.dvd_library', title: 'DVD Library' }; }

    _state(){ return this._hass?.states?.[this._cfg.entity]; }

    _items(){
      const st = this._state();
      const src = (st && Array.isArray(st.attributes?.items)) ? st.attributes.items : [];
      return src.map(it=>({
        title: it.title || '',
        year: it.year || '',
        poster: it.poster || '',
        imdb_id: it.imdb_id || '',
        barcode: it.barcode || '',
        box: toIntOrNull(it.box)
      }));
    }

    async _ensurePrivilege(){
      if (this._isPriv !== null || !this._hass?.callWS) return;
      try {
        const user = await this._hass.callWS({ type: 'auth/current_user' });
        this._isPriv = !!(user && (user.is_admin || user.is_owner));
      } catch(e){ this._isPriv = false; }
    }

    _canDelete(){
      const mode = this._cfg.allow_delete || 'auto';
      if (mode === 'never') return false;
      if (mode === 'always') return true;
      return !!this._isPriv; // auto
    }

    _bestSelector(it){
      if (it.imdb_id) return { imdb_id: it.imdb_id };
      if (it.barcode) return { barcode: it.barcode };
      return { title: it.title };
    }

    async _deleteItem(it){
      const ident = this._bestSelector(it);
      const title = it.title || it.imdb_id || it.barcode || 'this item';
      if (!confirm(`Delete \"${title}\" from your DVD Library?`)) return;
      try{
        await this._hass.callService('dvd_library','remove_item', ident);
      }catch(e){
        console.error('dvd-library-pro-card delete failed', e);
        alert('Failed to delete item. Check logs.');
      }
    }

    async _setBoxInline(it){
      const current = (it.box!==null && it.box!==undefined) ? String(it.box) : '';
      const v = prompt(`Set box number for \"${it.title || it.imdb_id || it.barcode}\"`, current);
      if (v===null) return; // canceled
      const vtrim = String(v).trim();
      if (!/^\d+$/.test(vtrim)) { alert('Please enter an integer box number.'); return; }
      const box = parseInt(vtrim,10);
      try{
        await this._hass.callService('dvd_library','set_box', Object.assign(this._bestSelector(it), { box }));
      }catch(e){
        console.error('dvd-library-pro-card set_box failed', e);
        alert('Failed to set box. Check logs.');
      }
    }

    _tapAction(it){
      const act = (this._cfg.actions?.tap)||'imdb';
      if (act==='imdb' && it.imdb_id){
        const url = `https://www.imdb.com/title/${encodeURIComponent(it.imdb_id)}/`;
        window.open(url, '_blank', 'noopener');
      }
    }

    _holdAction(it){
      const act = (this._cfg.actions?.hold)||'none';
      if (act==='set_box') return this._setBoxInline(it);
      if (act==='delete') return this._deleteItem(it);
    }

    _attachPressHandlers(tile, onTap, onHold){
      let timer = null; let down = false;
      const start = ()=>{ down=true; timer = setTimeout(()=>{ timer=null; if(down) onHold(); }, 550); };
      const clear = (fireTap)=>{ if(timer){ clearTimeout(timer); timer=null; if(fireTap) onTap(); } down=false; };
      tile.addEventListener('pointerdown', start);
      tile.addEventListener('pointerup', ()=> clear(true));
      tile.addEventListener('pointerleave', ()=> clear(false));
      tile.addEventListener('pointercancel', ()=> clear(false));
    }

    _render(){
      if (!this._cfg || !this._hass) return;
      const cfg = this._cfg;
      const st = this._state();
      const count = st?.state ?? 0;
      const list = this._items();

      // Unique boxes for filter
      const boxSet = new Set();
      list.forEach(i=>{ if(i.box!==null && i.box!==undefined) boxSet.add(i.box); });
      const boxes = Array.from(boxSet).sort((a,b)=> a-b);

      // Filter by query and box
      const q = (this._query||'').toLowerCase().trim();
      let filtered = q ? list.filter(i => (i.title||'').toLowerCase().includes(q)) : list;
      if (this._boxFilter!=='all'){
        const b = Number(this._boxFilter);
        filtered = filtered.filter(i=> i.box===b);
      }

      const max = Number(cfg.max_items)||0;
      const view = max>0 ? filtered.slice(0, max) : filtered;

      // Build card
      const card = document.createElement('ha-card');
      card.className = 'card';
      const style = document.createElement('style'); style.textContent = STYLE; card.appendChild(style);

      // Header
      const header = document.createElement('div');
      header.className = 'header';
      header.innerHTML = `<div class="title">${esc(cfg.title)}</div><div class="meta">${esc(count)} items</div>`;
      card.appendChild(header);

      // Controls
      const ctr = document.createElement('div'); ctr.className = 'controls';
      // Search box
      const search = document.createElement('input'); search.className='search'; search.placeholder='Search title...'; search.value=this._query;
      search.addEventListener('input', e=>{ this._query = String(e.target.value||''); this._render(); });
      ctr.appendChild(search);

      // Box filter
      if (cfg.show_filters){
        const sel = document.createElement('select'); sel.className='select';
        const mkOpt=(v,txt)=>{ const o=document.createElement('option'); o.value=String(v); o.textContent=txt; return o; };
        sel.appendChild(mkOpt('all','All boxes'));
        boxes.forEach(b=> sel.appendChild(mkOpt(b, `Box ${b}`)) );
        sel.value = String(this._boxFilter);
        sel.addEventListener('change', e=>{ this._boxFilter = e.target.value; this._render(); });
        ctr.appendChild(sel);
      }

      card.appendChild(ctr);

      if (!view.length){
        const empty = document.createElement('div'); empty.className='empty'; empty.textContent = (q||this._boxFilter!=='all') ? 'No matches' : 'No items';
        card.appendChild(empty);
      } else {
        const wrap = document.createElement('div'); wrap.className='grid-wrap';
        const grid = document.createElement('div'); grid.className='grid'; grid.style.setProperty('--aspect', cfg.aspect_ratio || '2/3');

        if ((cfg.orientation||'horizontal') === 'horizontal'){
          const rows = Math.max(1, Number(cfg.rows)||1);
          wrap.style.overflowX = 'auto'; wrap.style.overflowY = 'hidden';
          grid.style.gridAutoFlow = 'column';
          grid.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
          grid.style.gridAutoColumns = 'minmax(140px, 1fr)';
          grid.style.gridAutoRows = '1fr';
          wrap.style.maxHeight = `${rows * 250}px`;
        } else {
          const cols = Math.max(1, Number(cfg.columns)||4);
          wrap.style.overflowY = 'auto'; wrap.style.overflowX = 'hidden';
          grid.style.gridTemplateColumns = `repeat(${cols}, minmax(140px, 1fr))`;
        }

        const canDelete = this._canDelete();

        for (const it of view){
          const tile = document.createElement('div'); tile.className='tile';

          // Poster
          if (cfg.show.poster){
            const img = document.createElement('img'); img.className='poster'; img.loading='lazy'; img.decoding='async'; img.referrerPolicy='no-referrer';
            const url = forceHttps(it.poster);
            img.src = url || "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='320' height='480'><rect width='100%' height='100%' fill='%23222222'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='%23888888' font-size='18'>No Poster</text></svg>";
            tile.appendChild(img);
          }

          // Box badge
          if (cfg.show.box && it.box !== null){
            const badge = document.createElement('div'); badge.className='box-badge'; badge.textContent = `Box ${it.box}`; tile.appendChild(badge);
          }

          // Delete button (top-right)
          if (canDelete){
            const del = document.createElement('div'); del.className='delete'; del.title='Delete this item'; del.innerHTML='✕';
            del.addEventListener('click', (ev)=>{ ev.stopPropagation(); this._deleteItem(it); });
            tile.appendChild(del);
          }

          // Caption
          if (cfg.show.title || cfg.show.year || cfg.show.imdb_id || cfg.show.barcode){
            const caption = document.createElement('div'); caption.className='caption';
            if (cfg.show.title){
              const yr = (cfg.show.year && it.year) ? ` (${esc(it.year)})` : '';
              const nm = document.createElement('div'); nm.className='name'; nm.title = it.title || '';
              nm.innerHTML = `${esc(it.title)}${yr}`; caption.appendChild(nm);
            }
            if (cfg.show.imdb_id || cfg.show.barcode){
              const sub = document.createElement('div'); sub.className='sub';
              if (cfg.show.imdb_id && it.imdb_id) sub.innerHTML = `IMDb: ${esc(it.imdb_id)}`;
              else if (cfg.show.barcode && it.barcode) sub.innerHTML = `Barcode: ${esc(it.barcode)}`;
              else sub.innerHTML = '&nbsp;';
              caption.appendChild(sub);
            }
            tile.appendChild(caption);
          }

          // Press handlers (tap/hold)
          this._attachPressHandlers(tile, ()=> this._tapAction(it), ()=> this._holdAction(it));

          grid.appendChild(tile);
        }
        wrap.appendChild(grid); card.appendChild(wrap);
      }

      this._shadow.innerHTML=''; this._shadow.appendChild(card);
    }
  }

  class DvdLibraryProCardEditor extends HTMLElement {
    constructor(){ super(); this._cfg = null; this._shadow = this.attachShadow({mode:'open'}); }
    set hass(h){ this._hass=h; }
    setConfig(config){ const d = JSON.parse(JSON.stringify(DEFAULTS)); const merge=(t,s)=>{for(const k in s){ if(s[k]&&typeof s[k]==='object'&&!Array.isArray(s[k])){ t[k]=t[k]||{}; merge(t[k],s[k]); } else t[k]=s[k]; }}; merge(d, config||{}); d.actions = Object.assign({}, DEFAULTS.actions, d.actions||{}); this._cfg=d; this._render(); }

    _emit(){ const ev=new Event('config-changed',{bubbles:true, composed:true}); ev.detail={config:this._cfg}; this.dispatchEvent(ev); }

    _render(){ const c=this._cfg || DEFAULTS; const html=`
      <style>
        .ed { padding: 8px; display:grid; gap:10px; }
        .row { display:grid; grid-template-columns: 170px 1fr; align-items:center; gap:10px; }
        .group { border:1px solid var(--divider-color); border-radius:8px; padding:8px; }
        .group h4 { margin:0 0 6px 0; font-size:13px; color: var(--secondary-text-color); }
        .cols { display:grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap:8px; }
        input[type='text'], select, input[type='number'] { width:100%; }
        label { font-size:13px; }
      </style>
      <div class="ed">
        <div class="row">
          <label>Entity</label>
          <ha-entity-picker .hass=${'__hass__'} .value="${c.entity||''}" .includeDomains=${JSON.stringify(['sensor'])}></ha-entity-picker>
        </div>
        <div class="row">
          <label>Title</label>
          <input id="title" type="text" value="${esc(c.title)}"/>
        </div>
        <div class="row">
          <label>Orientation</label>
          <select id="orientation">
            <option value="horizontal" ${c.orientation==='horizontal'?'selected':''}>Horizontal (rows + horizontal scroll)</option>
            <option value="vertical" ${c.orientation==='vertical'?'selected':''}>Vertical (columns + vertical scroll)</option>
          </select>
        </div>
        <div class="row"><label>Rows (horizontal)</label><input id="rows" type="number" min="1" value="${Number(c.rows)||2}"/></div>
        <div class="row"><label>Columns (vertical)</label><input id="columns" type="number" min="1" value="${Number(c.columns)||5}"/></div>
        <div class="row"><label>Max items (0 = all)</label><input id="max_items" type="number" min="0" value="${Number(c.max_items)||0}"/></div>
        <div class="row"><label>Poster aspect ratio</label><input id="aspect_ratio" type="text" value="${esc(c.aspect_ratio||'2/3')}" placeholder="2/3, 16/9, ..."/></div>
        <div class="row"><label>Delete button</label>
          <select id="allow_delete">
            <option value="auto" ${c.allow_delete==='auto'?'selected':''}>Auto (admins/owners only)</option>
            <option value="always" ${c.allow_delete==='always'?'selected':''}>Always show</option>
            <option value="never" ${c.allow_delete==='never'?'selected':''}>Never show</option>
          </select>
        </div>
        <div class="row"><label>Show filters</label><select id="show_filters"><option value="true" ${c.show_filters?'selected':''}>Yes</option><option value="false" ${!c.show_filters?'selected':''}>No</option></select></div>
        <div class="group">
          <h4>Tap/Hold actions</h4>
          <div class="row"><label>Tap action</label>
            <select id="tap_action">
              <option value="imdb" ${c.actions?.tap==='imdb'?'selected':''}>Open IMDb (if available)</option>
              <option value="none" ${c.actions?.tap==='none'?'selected':''}>None</option>
            </select>
          </div>
          <div class="row"><label>Hold action</label>
            <select id="hold_action">
              <option value="none" ${c.actions?.hold==='none'?'selected':''}>None</option>
              <option value="set_box" ${c.actions?.hold==='set_box'?'selected':''}>Set box (inline)</option>
              <option value="delete" ${c.actions?.hold==='delete'?'selected':''}>Delete</option>
            </select>
          </div>
        </div>
        <div class="group">
          <h4>Show fields</h4>
          <div class="cols">
            <label><input id="show_poster" type="checkbox" ${c.show?.poster?'checked':''}/> Poster</label>
            <label><input id="show_title" type="checkbox" ${c.show?.title?'checked':''}/> Title</label>
            <label><input id="show_year" type="checkbox" ${c.show?.year?'checked':''}/> Year</label>
            <label><input id="show_imdb" type="checkbox" ${c.show?.imdb_id?'checked':''}/> IMDb ID</label>
            <label><input id="show_barcode" type="checkbox" ${c.show?.barcode?'checked':''}/> Barcode</label>
            <label><input id="show_box" type="checkbox" ${c.show?.box?'checked':''}/> Box badge</label>
          </div>
        </div>
      </div>`;

      this._shadow.innerHTML = html;

      const set = (id, fn)=>{ const el=this._shadow.getElementById(id); if(el) el.addEventListener('change', fn); };

      const ep = this._shadow.querySelector('ha-entity-picker'); if(ep){ try{ep.hass=this._hass;}catch(e){} ep.addEventListener('value-changed', e=>{ this._cfg.entity=e.detail.value; this._emit(); }); }
      set('title', e=>{ this._cfg.title=e.target.value; this._emit(); });
      set('orientation', e=>{ this._cfg.orientation=e.target.value; this._emit(); });
      set('rows', e=>{ this._cfg.rows=Math.max(1, Number(e.target.value||1)); this._emit(); });
      set('columns', e=>{ this._cfg.columns=Math.max(1, Number(e.target.value||1)); this._emit(); });
      set('max_items', e=>{ this._cfg.max_items=Math.max(0, Number(e.target.value||0)); this._emit(); });
      set('aspect_ratio', e=>{ this._cfg.aspect_ratio=e.target.value||'2/3'; this._emit(); });
      set('allow_delete', e=>{ this._cfg.allow_delete=e.target.value; this._emit(); });
      set('show_filters', e=>{ this._cfg.show_filters = (e.target.value==='true'); this._emit(); });
      set('tap_action', e=>{ this._cfg.actions=this._cfg.actions||{}; this._cfg.actions.tap=e.target.value; this._emit(); });
      set('hold_action', e=>{ this._cfg.actions=this._cfg.actions||{}; this._cfg.actions.hold=e.target.value; this._emit(); });

      const bool = (id, key)=> set(id, e=>{ this._cfg.show=this._cfg.show||{}; this._cfg.show[key]=!!e.target.checked; this._emit(); });
      bool('show_poster','poster'); bool('show_title','title'); bool('show_year','year'); bool('show_imdb','imdb_id'); bool('show_barcode','barcode'); bool('show_box','box');
    }
  }

  if (!customElements.get(ELEMENT)) customElements.define(ELEMENT, DvdLibraryProCard);
  if (!customElements.get(EDITOR))  customElements.define(EDITOR,  DvdLibraryProCardEditor);
})();
