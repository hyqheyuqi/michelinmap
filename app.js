const awardLabels = {
  "bib-gourmand": "必比登",
  "1-star": "1 星",
  "2-stars": "2 星",
  "3-stars": "3 星",
};

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const map = new maplibregl.Map({
  container: "map",
  center: [12, 28],
  zoom: 1.55,
  minZoom: 1,
  maxZoom: 16,
  attributionControl: false,
  style: {
    version: 8,
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: "© OpenStreetMap contributors",
      },
    },
    layers: [
      { id: "osm", type: "raster", source: "osm", paint: { "raster-saturation": -0.78, "raster-contrast": -0.08, "raster-brightness-min": 0.2, "raster-brightness-max": 0.94 } },
    ],
  },
});

map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

let cityData;
let restaurantsByCity;
let activePopup;
let activeRestaurants = [];
let focusedCityKey;
let activeCityFeature;
let filteredCityData;
const cityPanel = document.querySelector("#city-panel");
const panelContent = document.querySelector("#city-panel-content");
const heroCard = document.querySelector("#hero-card");
const searchInput = document.querySelector("#city-search");
const searchResults = document.querySelector("#search-results");
const mapLegend = document.querySelector("#map-legend");
const levelUpButton = document.querySelector("#level-up");
const levelDownButton = document.querySelector("#level-down");
const filterToggle = document.querySelector("#filter-toggle");
const filterPopover = document.querySelector("#filter-popover");
const cuisineFilter = document.querySelector("#cuisine-filter");
const cuisineOptions = document.querySelector("#cuisine-options");
const navigationStack = [];

function updateLevelUpButton() {
  const zoom = map.getZoom();
  levelUpButton.disabled = zoom <= 1.75;
  levelDownButton.disabled = zoom >= 13.8;
}

function pushMapState() {
  navigationStack.push({
    center: map.getCenter().toArray(),
    zoom: map.getZoom(),
    focusedCityKey,
    heroHidden: heroCard.classList.contains("is-hidden"),
  });
  updateLevelUpButton();
}

function navigateUpOneLevel() {
  const currentZoom = map.getZoom();
  if (currentZoom <= 1.75) return;
  map.stop();

  // 餐厅特写先轻微退到街道总览，第二次再退到城市尺度。
  if (activeCityFeature && currentZoom > 15) {
    map.easeTo({
      center: map.getCenter(),
      zoom: 14.2,
      offset: window.innerWidth > 760 ? [-205, 0] : [0, -145],
      duration: 480,
    });
    return;
  }

  if (activeCityFeature && currentZoom > 9) {
    map.easeTo({
      center: activeCityFeature.geometry.coordinates,
      zoom: 8.4,
      offset: window.innerWidth > 760 ? [-205, 0] : [0, -145],
      duration: 520,
    });
    return;
  }

  let previous;
  while (navigationStack.length) {
    const candidate = navigationStack.pop();
    if (candidate.zoom < currentZoom - 0.65) {
      previous = candidate;
      break;
    }
  }

  const cityCenter = activeCityFeature?.geometry.coordinates;
  if (activeCityFeature) {
    clearRestaurantPins();
    cityPanel.classList.remove("is-open");
    cityPanel.setAttribute("aria-hidden", "true");
  }

  const targetZoom = currentZoom > 9
    ? 8.4
    : currentZoom > 5.5
      ? 3.8
      : 1.55;
  const targetCenter = targetZoom <= 1.75
    ? [12, 28]
    : cityCenter || (previous && Math.abs(previous.zoom - targetZoom) < 1.5 ? previous.center : map.getCenter());
  if (targetZoom <= 1.75) navigationStack.length = 0;
  focusedCityKey = previous?.focusedCityKey;
  heroCard.classList.toggle("is-hidden", targetZoom > 1.75 || previous?.heroHidden);
  map.easeTo({ center: targetCenter, zoom: targetZoom, duration: 520 });
  updateLevelUpButton();
}

function showCityLegend() {
  if (!mapLegend) return;
  mapLegend.innerHTML = `<span><i class="dot city-dot"></i>米其林城市</span><span><i class="dot cluster-dot"></i>城市聚合</span>`;
}

function showRestaurantLegend() {
  if (!mapLegend) return;
  mapLegend.innerHTML = `<span><i class="dot three-dot"></i>三星</span><span><i class="dot two-dot"></i>二星</span><span><i class="dot one-dot"></i>一星</span><span><i class="dot bib-dot"></i>必比登</span>`;
}

async function loadData() {
  const [citiesResponse, restaurantsResponse] = await Promise.all([
    fetch("data/cities.geojson"),
    fetch("data/city-restaurants.json"),
  ]);
  if (!citiesResponse.ok || !restaurantsResponse.ok) throw new Error("地图数据加载失败");
  cityData = await citiesResponse.json();
  restaurantsByCity = await restaurantsResponse.json();
  filteredCityData = cityData;

  const cuisines = [...new Set(
    Object.values(restaurantsByCity).flat().map((restaurant) => restaurant.cuisine).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b));
  cuisineOptions.insertAdjacentHTML(
    "beforeend",
    cuisines.map((cuisine) => `<option value="${escapeHtml(cuisine)}">${escapeHtml(cuisine)}</option>`).join("")
  );
}

function checkedValues(name) {
  return new Set(
    [...filterPopover.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value)
  );
}

function currentFilters() {
  return { awards: checkedValues("award"), prices: checkedValues("price"), cuisine: cuisineFilter.value };
}

function getFilteredRestaurants(cityKey, filters = currentFilters()) {
  const { awards, prices, cuisine } = filters;
  const cuisineQuery = cuisine.trim().toLocaleLowerCase();
  return (restaurantsByCity[cityKey] || []).filter((restaurant) =>
    awards.has(restaurant.award) &&
    prices.has(String([...restaurant.price_symbols].length)) &&
    (!cuisineQuery || String(restaurant.cuisine || "").toLocaleLowerCase().includes(cuisineQuery))
  );
}

function featureWithCounts(feature, restaurants) {
  const counts = { "bib-gourmand": 0, "1-star": 0, "2-stars": 0, "3-stars": 0 };
  restaurants.forEach((restaurant) => { counts[restaurant.award] += 1; });
  return {
    ...feature,
    properties: {
      ...feature.properties,
      total: restaurants.length,
      bib_gourmand: counts["bib-gourmand"],
      one_star: counts["1-star"],
      two_stars: counts["2-stars"],
      three_stars: counts["3-stars"],
    },
  };
}

function applyFilters() {
  const filters = currentFilters();
  filteredCityData = {
    type: "FeatureCollection",
    features: cityData.features
      .map((feature) => featureWithCounts(feature, getFilteredRestaurants(feature.properties.city_key, filters)))
      .filter((feature) => feature.properties.total > 0),
  };
  if (map.getSource("cities")) map.getSource("cities").setData(filteredCityData);

  if (activeCityFeature) {
    const feature = filteredCityData.features.find(
      (item) => item.properties.city_key === activeCityFeature.properties.city_key
    );
    if (feature) {
      activeCityFeature = feature;
      const restaurants = getFilteredRestaurants(feature.properties.city_key);
      activeRestaurants = restaurants;
      map.getSource("restaurants").setData(restaurantFeatures(restaurants));
      renderCity(feature.properties);
    } else {
      cityPanel.classList.remove("is-open");
      clearRestaurantPins();
    }
  }
  if (searchInput.value) runSearch(searchInput.value);
}

function cityTitle(props) {
  return props.city === props.country ? props.city : `${props.city}, ${props.country}`;
}

function renderCity(props) {
  const restaurants = getFilteredRestaurants(props.city_key);
  const location = [props.city, props.region, props.country].filter(Boolean).join(" · ");
  panelContent.innerHTML = `
    <header class="panel-header">
      <p class="eyebrow">CITY GUIDE · ${escapeHtml(props.total)} PLACES</p>
      <h2>${escapeHtml(props.city)}</h2>
      <p>${escapeHtml(location)}</p>
      <div class="award-strip">
        <div><strong>${props.three_stars}</strong><span>三星</span></div>
        <div><strong>${props.two_stars}</strong><span>二星</span></div>
        <div><strong>${props.one_star}</strong><span>一星</span></div>
        <div><strong>${props.bib_gourmand}</strong><span>必比登</span></div>
      </div>
    </header>
    <div class="restaurant-list">
      ${restaurants.map((restaurant) => `
        <article class="restaurant-card" data-restaurant-id="${escapeHtml(restaurant.id)}" tabindex="0">
          <div class="restaurant-card-top">
            <h3>${escapeHtml(restaurant.name)}</h3>
            <span class="award-badge">${awardLabels[restaurant.award]}</span>
          </div>
          <p class="restaurant-meta">${escapeHtml(restaurant.cuisine)} · ${escapeHtml(restaurant.price_symbols)}</p>
          <p class="restaurant-address">${escapeHtml(restaurant.address)}</p>
          <a class="restaurant-link" href="${escapeHtml(restaurant.source_url)}" target="_blank" rel="noopener noreferrer">查看米其林页面 ↗</a>
        </article>
      `).join("")}
    </div>`;
  cityPanel.classList.add("is-open");
  cityPanel.setAttribute("aria-hidden", "false");
  heroCard.classList.add("is-hidden");
}

function renderRestaurantDetail(restaurant) {
  const city = activeCityFeature?.properties;
  const location = city
    ? [city.city, city.region, city.country].filter(Boolean).join(" · ")
    : "";
  panelContent.innerHTML = `
    <header class="panel-header restaurant-detail-header">
      <button class="restaurant-back" type="button">← ${escapeHtml(city?.city || "城市餐厅")}</button>
      <p class="eyebrow">${escapeHtml(awardLabels[restaurant.award])}</p>
      <h2>${escapeHtml(restaurant.name)}</h2>
      <p>${escapeHtml(restaurant.cuisine)} · ${escapeHtml(restaurant.price_symbols)}</p>
    </header>
    <div class="restaurant-detail-body">
      <section>
        <span>地址</span>
        <strong>${escapeHtml(restaurant.address)}</strong>
      </section>
      <section>
        <span>区域</span>
        <strong>${escapeHtml(location)}</strong>
      </section>
      <section>
        <span>荣誉</span>
        <strong>${escapeHtml(awardLabels[restaurant.award])}</strong>
      </section>
      <section>
        <span>菜系与价格</span>
        <strong>${escapeHtml(restaurant.cuisine)} · ${escapeHtml(restaurant.price_symbols)}</strong>
      </section>
      <a class="restaurant-detail-link" href="${escapeHtml(restaurant.source_url)}" target="_blank" rel="noopener noreferrer">查看米其林指南页面 ↗</a>
    </div>`;
  cityPanel.classList.add("is-open");
  cityPanel.setAttribute("aria-hidden", "false");
}

function restaurantFeatures(restaurants) {
  return {
    type: "FeatureCollection",
    features: restaurants.map((restaurant) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [restaurant.longitude, restaurant.latitude],
      },
      properties: restaurant,
    })),
  };
}

function showRestaurantPopup(feature) {
  if (activePopup) activePopup.remove();
  const restaurant = feature.properties;
  activePopup = new maplibregl.Popup({ offset: 13, closeButton: true, maxWidth: "300px" })
    .setLngLat(feature.geometry.coordinates)
    .setHTML(`
      <div class="restaurant-popup">
        <span>${escapeHtml(awardLabels[restaurant.award])}</span>
        <strong>${escapeHtml(restaurant.name)}</strong>
        <small>${escapeHtml(restaurant.cuisine)} · ${escapeHtml(restaurant.price_symbols)}</small>
        <p>${escapeHtml(restaurant.address)}</p>
      </div>`)
    .addTo(map);
}

function clearRestaurantPins() {
  if (map.getSource("restaurants")) {
    map.getSource("restaurants").setData({ type: "FeatureCollection", features: [] });
  }
  if (activePopup) {
    activePopup.remove();
    activePopup = undefined;
  }
  activeRestaurants = [];
  activeCityFeature = undefined;
  focusedCityKey = undefined;
  showCityLegend();
}

function selectCity(feature, saveCurrentView = true) {
  if (saveCurrentView) pushMapState();
  focusedCityKey = undefined;
  const filteredFeature = featureWithCounts(feature, getFilteredRestaurants(feature.properties.city_key));
  activeCityFeature = filteredFeature;
  const restaurants = getFilteredRestaurants(feature.properties.city_key);
  activeRestaurants = restaurants;
  showRestaurantLegend();
  map.getSource("restaurants").setData(restaurantFeatures(restaurants));
  map.flyTo({
    center: feature.geometry.coordinates,
    zoom: Math.max(map.getZoom(), window.innerWidth > 760 ? 14.2 : 13.5),
    offset: window.innerWidth > 760 ? [-205, 0] : [0, -145],
    duration: 1100,
  });
  renderCity(filteredFeature.properties);
  filterPopover.hidden = true;
  filterToggle.setAttribute("aria-expanded", "false");
  searchResults.hidden = true;
  searchInput.blur();
}

function handleCityClick(feature) {
  const cityKey = feature.properties.city_key;
  if (map.getZoom() >= 7.2 || focusedCityKey === cityKey) {
    selectCity(feature);
    return;
  }
  if (focusedCityKey !== cityKey) {
    pushMapState();
    focusedCityKey = cityKey;
    heroCard.classList.add("is-hidden");
    map.flyTo({
      center: feature.geometry.coordinates,
      zoom: Math.max(map.getZoom(), window.innerWidth > 760 ? 10.6 : 10.1),
      duration: 900,
    });
    return;
  }
}

async function drillIntoCluster(feature) {
  const source = map.getSource("cities");
  pushMapState();
  focusedCityKey = undefined;
  heroCard.classList.add("is-hidden");
  const leaves = await source.getClusterLeaves(feature.properties.cluster_id, 10000, 0);
  const bounds = new maplibregl.LngLatBounds();
  leaves.forEach((city) => bounds.extend(city.geometry.coordinates));
  const drillZoom = navigationStack.length === 1
    ? (window.innerWidth > 760 ? 3.8 : 3.4)
    : (window.innerWidth > 760 ? 8.4 : 7.8);
  const clusterCenter = feature.geometry.coordinates;
  const nearestCity = leaves.reduce((nearest, city) => {
    if (!nearest) return city;
    const distance = ([lng, lat]) =>
      Math.hypot(lng - clusterCenter[0], lat - clusterCenter[1]);
    return distance(city.geometry.coordinates) < distance(nearest.geometry.coordinates) ? city : nearest;
  }, null);
  const targetCenter = navigationStack.length === 1
    ? bounds.getCenter()
    : nearestCity.geometry.coordinates;
  map.flyTo({
    center: targetCenter,
    zoom: Math.max(map.getZoom() + 1.2, drillZoom),
    duration: 1000,
  });
}

function nearestVisibleFeature() {
  const features = map.queryRenderedFeatures({ layers: ["clusters", "city-points"] });
  const center = { x: map.getCanvas().clientWidth / 2, y: map.getCanvas().clientHeight / 2 };
  return features.sort((a, b) => {
    const pointA = map.project(a.geometry.coordinates);
    const pointB = map.project(b.geometry.coordinates);
    return Math.hypot(pointA.x - center.x, pointA.y - center.y) -
      Math.hypot(pointB.x - center.x, pointB.y - center.y);
  })[0];
}

map.on("load", async () => {
  try {
    // 使用 MapLibre 原生触控板识别，只提高响应倍率，避免自定义 wheel 拦截造成卡死。
    map.scrollZoom.setWheelZoomRate(1 / 90);
    map.scrollZoom.setZoomRate(1 / 32);
    await loadData();
    map.addSource("cities", {
      type: "geojson",
      data: filteredCityData,
      cluster: true,
      clusterMaxZoom: 4,
      clusterRadius: 34,
    });
    map.addSource("restaurants", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });

    map.addLayer({
      id: "clusters",
      type: "circle",
      source: "cities",
      filter: ["has", "point_count"],
      paint: {
        "circle-color": ["step", ["get", "point_count"], "#d2ad68", 20, "#bd8642", 80, "#9f1f2d"],
        "circle-radius": ["step", ["get", "point_count"], 17, 20, 22, 80, 29],
        "circle-stroke-width": 3,
        "circle-stroke-color": "rgba(255,255,255,.8)",
      },
    });
    map.addLayer({
      id: "cluster-count",
      type: "symbol",
      source: "cities",
      filter: ["has", "point_count"],
      layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12, "text-font": ["Open Sans Semibold"] },
      paint: { "text-color": "#fff" },
    });
    map.addLayer({
      id: "city-points",
      type: "circle",
      source: "cities",
      maxzoom: 12,
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": "rgba(255,250,245,.92)",
        "circle-radius": [
          "interpolate", ["linear"], ["zoom"],
          2, ["interpolate", ["linear"], ["get", "total"], 1, 4, 20, 5.4, 100, 7.4],
          5, ["interpolate", ["linear"], ["get", "total"], 1, 5.6, 20, 8.1, 100, 11.1],
          10, ["interpolate", ["linear"], ["get", "total"], 1, 7.1, 20, 9.6, 100, 12.6],
        ],
        "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 2, 2, 5, 3],
        "circle-stroke-color": "#9f1f2d",
      },
    });
    map.addLayer({
      id: "city-center-dots",
      type: "circle",
      source: "cities",
      maxzoom: 12,
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": "#9f1f2d",
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 1.5, 5, 2.2, 10, 3],
      },
    });
    map.addLayer({
      id: "major-city-labels",
      type: "symbol",
      source: "cities",
      minzoom: 2.15,
      maxzoom: 4.5,
      filter: ["all", ["!", ["has", "point_count"]], [">=", ["get", "total"], 24]],
      layout: {
        "text-field": ["get", "city"],
        "text-font": ["Open Sans Semibold"],
        "text-size": 10,
        "text-offset": [0, 1.1],
        "text-anchor": "top",
        "text-optional": true,
      },
      paint: { "text-color": "#3f3933", "text-halo-color": "rgba(248,245,238,.94)", "text-halo-width": 1.4 },
    });
    map.addLayer({
      id: "city-labels",
      type: "symbol",
      source: "cities",
      minzoom: 2.8,
      maxzoom: 12,
      filter: ["!", ["has", "point_count"]],
      layout: {
        "text-field": ["get", "city"],
        "text-font": ["Open Sans Semibold"],
        "text-size": 11,
        "text-offset": [0, 1.3],
        "text-anchor": "top",
        "text-optional": true,
      },
      paint: { "text-color": "#3f3933", "text-halo-color": "rgba(248,245,238,.92)", "text-halo-width": 1.5 },
    });
    map.addLayer({
      id: "restaurant-points",
      type: "circle",
      source: "restaurants",
      paint: {
        "circle-color": [
          "match", ["get", "award"],
          "3-stars", "#78101e",
          "2-stars", "#a91f31",
          "1-star", "#d55a56",
          "#cf9b43",
        ],
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 5, 13, 8],
        "circle-stroke-width": 2,
        "circle-stroke-color": "#fffaf0",
      },
    });
    map.addLayer({
      id: "restaurant-labels",
      type: "symbol",
      source: "restaurants",
      minzoom: 7.8,
      layout: {
        "text-field": ["get", "name"],
        "text-font": ["Open Sans Semibold"],
        "text-size": 10,
        "text-offset": [0, 1.25],
        "text-anchor": "top",
        "text-optional": true,
      },
      paint: { "text-color": "#332e29", "text-halo-color": "rgba(248,245,238,.96)", "text-halo-width": 1.5 },
    });

    map.on("click", "clusters", async (event) => {
      const feature = map.queryRenderedFeatures(event.point, { layers: ["clusters"] })[0];
      if (feature) await drillIntoCluster(feature);
    });
    map.on("click", "city-points", (event) => handleCityClick(event.features[0]));
    map.on("click", "restaurant-points", (event) => focusRestaurant(event.features[0].properties));
    ["clusters", "city-points", "city-center-dots", "restaurant-points"].forEach((layer) => {
      map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
    });

    map.on("zoomend", updateLevelUpButton);
    updateLevelUpButton();
  } catch (error) {
    heroCard.querySelector(".hero-copy").textContent = "地图数据暂时无法加载，请刷新页面重试。";
    console.error(error);
  }
});

function runSearch(query) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized || !filteredCityData) { searchResults.hidden = true; return; }
  const cityMatches = filteredCityData.features
    .filter(({ properties: p }) => `${p.city} ${p.region} ${p.country}`.toLocaleLowerCase().includes(normalized))
    .sort((a, b) => b.properties.total - a.properties.total)
    .slice(0, 5);
  const restaurantMatches = [];
  const filters = currentFilters();
  for (const feature of filteredCityData.features) {
    for (const restaurant of getFilteredRestaurants(feature.properties.city_key, filters)) {
      if (restaurant.name.toLocaleLowerCase().includes(normalized)) {
        restaurantMatches.push({ restaurant, city: feature });
        if (restaurantMatches.length >= 6) break;
      }
    }
    if (restaurantMatches.length >= 6) break;
  }
  const cityHtml = cityMatches.map((feature) => `<button class="search-result" data-city-key="${feature.properties.city_key}"><span><strong>${escapeHtml(feature.properties.city)}</strong><small>${escapeHtml(feature.properties.country)} · 城市</small></span><b>${feature.properties.total} 家</b></button>`).join("");
  const restaurantHtml = restaurantMatches.map(({ restaurant, city }) => `<button class="search-result" data-city-key="${city.properties.city_key}" data-restaurant-id="${escapeHtml(restaurant.id)}"><span><strong>${escapeHtml(restaurant.name)}</strong><small>${escapeHtml(city.properties.city)} · ${escapeHtml(awardLabels[restaurant.award])}</small></span><b>餐厅</b></button>`).join("");
  searchResults.innerHTML = cityHtml || restaurantHtml
    ? cityHtml + restaurantHtml
    : `<div class="search-result"><small>没有找到匹配的城市或餐厅</small></div>`;
  searchResults.hidden = false;
}

searchInput.addEventListener("input", (event) => runSearch(event.target.value));
searchResults.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  const button = event.target.closest("[data-city-key]");
  if (!button) return;
  const feature = filteredCityData.features.find((item) => item.properties.city_key === button.dataset.cityKey);
  if (!feature) return;
  selectCity(feature);
  if (button.dataset.restaurantId) {
    const restaurant = getFilteredRestaurants(button.dataset.cityKey)
      .find((item) => item.id === button.dataset.restaurantId);
    if (restaurant) window.setTimeout(() => focusRestaurant(restaurant), 1150);
  }
});
function focusRestaurant(restaurant) {
  const feature = restaurantFeatures([restaurant]).features[0];
  map.flyTo({
    center: feature.geometry.coordinates,
    zoom: Math.max(map.getZoom(), 15.6),
    offset: window.innerWidth > 760 ? [-210, 0] : [0, -160],
    duration: 850,
  });
  showRestaurantPopup(feature);
  renderRestaurantDetail(restaurant);
}
panelContent.addEventListener("click", (event) => {
  if (event.target.closest("a")) return;
  if (event.target.closest(".restaurant-back")) {
    if (activeCityFeature) renderCity(activeCityFeature.properties);
    return;
  }
  const card = event.target.closest("[data-restaurant-id]");
  if (!card) return;
  const restaurant = activeRestaurants.find((item) => item.id === card.dataset.restaurantId);
  if (!restaurant) return;
  focusRestaurant(restaurant);
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".search-wrap")) searchResults.hidden = true;
  if (!event.target.closest(".filter-shell")) {
    filterPopover.hidden = true;
    filterToggle.setAttribute("aria-expanded", "false");
  }
});
document.querySelector("#panel-close").addEventListener("click", () => {
  cityPanel.classList.remove("is-open");
  cityPanel.setAttribute("aria-hidden", "true");
});
levelUpButton.addEventListener("click", () => {
  navigateUpOneLevel();
});
levelDownButton.addEventListener("click", async () => {
  if (focusedCityKey) {
    const feature = filteredCityData.features.find(
      (item) => item.properties.city_key === focusedCityKey
    );
    if (feature) selectCity(feature);
    return;
  }
  const feature = nearestVisibleFeature();
  if (!feature) return;
  if (feature.properties.cluster_id !== undefined) {
    await drillIntoCluster(feature);
  } else {
    handleCityClick(feature);
  }
});
filterToggle.addEventListener("click", (event) => {
  event.stopPropagation();
  filterPopover.hidden = !filterPopover.hidden;
  filterToggle.setAttribute("aria-expanded", String(!filterPopover.hidden));
});
filterPopover.addEventListener("change", applyFilters);
cuisineFilter.addEventListener("input", applyFilters);
document.querySelector("#filter-reset").addEventListener("click", () => {
  filterPopover.querySelectorAll('input[type="checkbox"]').forEach((input) => { input.checked = true; });
  cuisineFilter.value = "";
  applyFilters();
});
searchInput.addEventListener("focus", () => {
  filterPopover.hidden = true;
  filterToggle.setAttribute("aria-expanded", "false");
});
document.querySelector("#explore-btn").addEventListener("click", () => {
  heroCard.classList.add("is-hidden");
});
document.querySelector(".brand").addEventListener("click", (event) => {
  event.preventDefault();
  clearRestaurantPins();
  navigationStack.length = 0;
  updateLevelUpButton();
  cityPanel.classList.remove("is-open");
  heroCard.classList.remove("is-hidden");
  map.flyTo({ center: [12, 28], zoom: 1.55, duration: 1000 });
});
