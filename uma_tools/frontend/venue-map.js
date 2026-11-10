const libraryPath = '/uma_tools/vendor/leaflet/';
const japanTiles = {
  url: 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png',
  attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>',
  maxNativeZoom: 18,
};
const globalTiles = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>',
  maxNativeZoom: 19,
};

function loadAsset(element) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(fail, 8000);
    function fail() {
      clearTimeout(timer);
      element.remove();
      reject(new Error('地图组件加载失败'));
    }
    element.onload = () => { clearTimeout(timer); resolve(); };
    element.onerror = fail;
    document.head.append(element);
  });
}

let stylesheet;
let script;
function loadLeaflet() {
  if (!stylesheet) {
    const css = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: libraryPath + 'leaflet.css' });
    stylesheet = loadAsset(css).catch(error => { stylesheet = null; throw error; });
  }
  if (!script) {
    const js = Object.assign(document.createElement('script'), { src: libraryPath + 'leaflet.js' });
    script = loadAsset(js).catch(error => { script = null; throw error; });
  }
  return Promise.all([stylesheet, script]).then(() => window.L);
}

export const VenueMap = {
  props: { location: Object, title: String, country: String },
  setup(props) {
    const { ref, onMounted, onBeforeUnmount } = Vue;
    const canvas = ref(null);
    const state = ref('loading');
    let map;
    let observer;
    let visibilityObserver;
    let timer;
    let revision = 0;
    const zoom = 15;
    const center = [props.location.lat, props.location.lng];

    function dispose() {
      revision++;
      clearTimeout(timer);
      observer?.disconnect();
      visibilityObserver?.disconnect();
      map?.remove();
      map = null;
    }

    async function show() {
      dispose();
      const request = revision;
      state.value = 'loading';
      try {
        const L = await loadLeaflet();
        if (request !== revision) return;
        map = L.map(canvas.value, { scrollWheelZoom: false, zoomControl: false, maxZoom: 19 }).setView(center, zoom);
        const source = props.country === '日本' ? japanTiles : globalTiles;
        map.attributionControl.setPrefix(false);
        const layer = L.tileLayer(source.url, {
          attribution: source.attribution,
          maxNativeZoom: source.maxNativeZoom,
          updateWhenIdle: true,
          keepBuffer: 0,
        });
        const color = getComputedStyle(canvas.value).getPropertyValue('--ui-cobalt-deep').trim();
        const fillColor = getComputedStyle(canvas.value).getPropertyValue('--ui-orange').trim();
        L.circleMarker(center, { color, fillColor, fillOpacity: 1, weight: 3, radius: 8 }).addTo(map);
        const name = document.createElement('span');
        name.textContent = props.title;
        L.tooltip({ permanent: true, direction: 'top', offset: [0, -9] }).setLatLng(center).setContent(name).addTo(map);
        timer = setTimeout(() => {
          if (state.value === 'loading') state.value = 'error';
        }, 8000);
        layer.once('tileload', () => {
          clearTimeout(timer);
          state.value = 'ready';
        });
        layer.addTo(map);
        observer = new ResizeObserver(() => map?.invalidateSize({ pan: false }));
        observer.observe(canvas.value);
      } catch {
        if (request === revision) state.value = 'error';
      }
    }
    onMounted(() => {
      if (!('IntersectionObserver' in window)) return show();
      visibilityObserver = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) show();
      }, { rootMargin: '240px' });
      visibilityObserver.observe(canvas.value);
    });
    onBeforeUnmount(dispose);
    return {
      canvas, state, show,
    };
  },
  template: `
    <div class="venue-map-frame">
      <div class="venue-map-canvas" ref="canvas" :aria-label="title+'地图'"></div>
      <content-state v-if="state==='loading'" state="loading" subject="地图"></content-state>
      <content-state v-if="state==='error'" state="error" subject="地图" :retry="true" @retry="show"></content-state>
    </div>`,
};
