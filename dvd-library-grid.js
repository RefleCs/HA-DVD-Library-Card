// DVD Library Card – v0.1.3
// Element name: dvd-library-card
// Plain JS Web Component (no framework).
// - Auto-refreshes on state_changed for the configured sensor
// - Renders movie posters (force https for http posters)
// - Shows "Box N" per DVD when item.box is an integer
// - Simple client-side search by title

(function () {
  const VERSION = "0.1.3";
  console.info(`dvd-library-card: script loaded v${VERSION}`);

  const STYLE = `
  :host { display:block; }
  .card {
    padding: 12px 12px 4px 12px;
  }
  .header {
    display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom: 8px;
  }
  .title {
    font-weight: 600; font-size: 16px;
  }
  .meta {
    color: var(--secondary-text-color);
    font-size: 12px;
  }
  .row {
    display:flex; align-items:center; gap:8px; margin: 8px 0 12px 0;
  }
  .search {
    width: 100%;
    box-sizing: border-box;
    height: 36px; padding: 6px 10px;
    border-radius: 6px; border: 1px solid var(--divider-color);
    background: var(--card-background-color);
    color: var(--primary-text-color);
  }
  .grid {
    display:grid;
    grid-template-columns: repeat(auto-fill, minmax(128px, 1fr));
    gap: 10px;
  }
  .tile {
    position: relative;
    border-radius: 8px;
    overflow: hidden;
    background: #1114;
    display:flex; flex-direction:column;
    border: 1px solid var(--divider-color);
  }
  .poster {
    width: 100%;
    aspect-ratio: 2/3;
    object-fit: cover;
    background: #1c1c1c;
  }
  .box-badge {
    position: absolute;
    top: 6px; left: 6px;
    background: var(--primary-color);
    color: var(--text-primary-color, #fff);
    font-size: 12px; font-weight: 600;
    padding: 2px 6px; border-radius: 999px;
    box-shadow: 0 1px 3px rgba(0,0,0,.4);
  }
  .caption {
    padding: 8px;
    display:flex; flex-direction:column; gap: 2px;
  }
  .name {
    font-size: 14px; font-weight: 600; line-height: 1.2;
  }
  .sub {
    font-size: 12px; color: var(--secondary-text-color);
  }
  .empty {
    text-align:center; padding: 24px 8px; color: var(--secondary-text-color);
  }
  `;

  function esc(s) {
    if (s === null || s === undefined) return "";
    return String(s)
      .replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }
  function forceHttps(url) {
    if (!url) return "";
    if (typeof url !== "string") return "";
    if (url.startsWith("http://")) return "https://" + url.substring(7);
    return url;
  }
  function isInt(v) {
    return typeof v === "number" && Number.isInteger(v);
  }

  class DvdLibraryCard extends HTMLElement {
    constructor() {
      super();
      this._config = null;
      this._hass = null;
      this._card = null;
      this._search = "";
      this._unsubscribe = null;
      this._shadow = this.attachShadow({ mode: "open" });
    }

    connectedCallback() {
      this._ensureSubscribe();
    }

    disconnectedCallback() {
      if (this._unsubscribe) {
        try { this._unsubscribe(); } catch(e) {}
        this._unsubscribe = null;
      }
    }

    set hass(hass) {
      this._hass = hass;
      if (!this._config) return;
      this._ensureSubscribe();
      this._render();
    }

    setConfig(config) {
      if (!config.entity) throw new Error("Please set 'entity' (e.g., sensor.dvd_library)");
      this._config = {
        title: "DVD Library",
        ...config,
      };
      this._search = "";
      this._render();
    }

    getCardSize() { return 5; }

    _ensureSubscribe() {
      if (!this._hass || !this._config) return;
      if (!this._hass.connection || !this._hass.connection.subscribeEvents) return;
      if (this._unsubscribe) return;

      // Only re-render when our sensor changes to avoid spam
      this._hass.connection
        .subscribeEvents((ev) => {
          try {
            const ent = ev && ev.data && ev.data.entity_id;
            if (ent === this._config.entity) this._render();
          } catch (e) {}
        }, "state_changed")
        .then((unsub) => { this._unsubscribe = unsub; })
        .catch(() => {});
    }

    _getItems() {
      if (!this._hass || !this._config) return [];
      const st = this._hass.states[this._config.entity];
      if (!st || !st.attributes) return [];
      const items = Array.isArray(st.attributes.items) ? st.attributes.items : [];
      // Normalize shape minimally
      return items.map((it) => ({
        title: it.title || "",
        year: it.year || "",
        poster: it.poster || "",
        imdb_id: it.imdb_id || "",
        barcode: it.barcode || "",
        box: (typeof it.box === "string" && /^\d+$/.test(it.box)) ? parseInt(it.box, 10) :
             (Number.isInteger(it.box) ? it.box : null),
      }));
    }

    _render() {
      const itemsAll = this._getItems();
      const query = (this._search || "").toLowerCase().trim();
      const items = !query ? itemsAll :
        itemsAll.filter((i) => (i.title || "").toLowerCase().includes(query));

      const st = this._hass?.states?.[this._config.entity];
      const count = (st && typeof st.state !== "undefined") ? st.state : itemsAll.length;

      // Build DOM
      const root = document.createElement("ha-card");
      root.className = "card";

      // Inject styles
      const style = document.createElement("style");
      style.textContent = STYLE;
      root.appendChild(style);

      // Header
      const header = document.createElement("div");
      header.className = "header";
      header.innerHTML = `
        <div class="title">${esc(this._config.title)}</div>
        <div class="meta">${esc(count)} items</div>
      `;
      root.appendChild(header);

      // Search
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = `
        <input class="search" placeholder="Search title..." value="${esc(this._search)}" />
      `;
      row.querySelector(".search").addEventListener("input", (e) => {
        this._search = String(e.target.value || "");
        this._render(); // re-render client-side filter
      });
      root.appendChild(row);

      // Grid
      if (!items.length) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = query ? "No matches" : "No items";
        root.appendChild(empty);
      } else {
        const grid = document.createElement("div");
        grid.className = "grid";

        for (const it of items) {
          const tile = document.createElement("div");
          tile.className = "tile";

          const posterURL = forceHttps(it.poster) || "";
          const img = document.createElement("img");
          img.className = "poster";
          img.loading = "lazy";
          img.decoding = "async";
          img.referrerPolicy = "no-referrer";
          img.src = posterURL || "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='320' height='480'><rect width='100%' height='100%' fill='%23222222'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='%23888888' font-size='18'>No Poster</text></svg>";
          tile.appendChild(img);

          // Box badge
          if (isInt(it.box)) {
            const badge = document.createElement("div");
            badge.className = "box-badge";
            badge.textContent = `Box ${it.box}`;
            tile.appendChild(badge);
          }

          // Caption
          const caption = document.createElement("div");
          caption.className = "caption";
          const year = it.year ? ` (${esc(it.year)})` : "";
          caption.innerHTML = `
            <div class="name" title="${esc(it.title)}">${esc(it.title)}${year}</div>
            <div class="sub">
              ${it.imdb_id ? `IMDb: ${esc(it.imdb_id)}` : (it.barcode ? `Barcode: ${esc(it.barcode)}` : "&nbsp;")}
            </div>
          `;
          tile.appendChild(caption);

          grid.appendChild(tile);
        }

        root.appendChild(grid);
      }

      // Attach / replace
      if (!this._card) {
        this._card = root;
        this._shadow.innerHTML = "";
        this._shadow.appendChild(this._card);
      } else {
        this._shadow.replaceChild(root, this._card);
        this._card = root;
      }
    }

    static getConfigElement() { return document.createElement("div"); }
    static getStubConfig() {
      return { entity: "sensor.dvd_library", title: "DVD Library" };
    }
  }

  // Register element if not yet defined
  if (!customElements.get("dvd-library-card")) {
    customElements.define("dvd-library-card", DvdLibraryCard);
  }
})();