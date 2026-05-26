let nodes = [];
let socket = null;
let currentPage = "dashboard";
let logAutoRefresh = false;
let logTimer = null;
let logSearch = "";
let currentLogNodeId = null;
let nodeFilter = "all";
let clockTimer = null;
let configEditorScope = "global";
let configEditorNodeId = 12;
let configApplyResult = null;
let renderRevision = 0;
let authExpired = false;
let desktopSidebarCollapsed = localStorage.getItem("ts.sidebar.collapsed") === "1";
let mobileSidebarOpen = false;
let nodesLastSyncAt = 0;
let nodesSyncPromise = null;
let paymentSelectedNodeId = null;
let activeVncSession = null;

const PAGE_TITLES = {
  dashboard: "Статистика",
  group: "Group",
  underground: "Underground",
  payment: "Оплата",
  servers: "Серверы",
  proxies: "Прокси",
  config: "Конфигурация",
  logs: "Логи",
  slots: "Слоты"
};

const PAGE_PREFIX = {
  dashboard: "Обзор",
  group: "Билеты",
  underground: "Билеты",
  payment: "Операции",
  servers: "Операции",
  proxies: "Настройки",
  config: "Настройки",
  logs: "Настройки",
  slots: "Обзор"
};

async function api(path, opts = {}) {
  const res = await fetch("/api" + path, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  let data = {};
  try {
    data = await res.json();
  } catch {}
  if (res.status === 401) {
    handleUnauthorized();
    throw new Error("Сессия истекла. Войдите заново.");
  }
  if (!res.ok) throw new Error(data.error || "Ошибка");
  return data;
}

function readNodeExtra(node) {
  if (!node || !node.extra) return {};
  try {
    return typeof node.extra === "string" ? JSON.parse(node.extra) : (node.extra || {});
  } catch {
    return {};
  }
}

function normalizeNodeData(node, options = {}) {
  if (!node) return node;
  const full = !!options.full;
  const normalized = { ...node };
  const assignIfPresent = (keys, targetKey, fallbackValue) => {
    if (full || keys.some((key) => Object.prototype.hasOwnProperty.call(node, key))) {
      normalized[targetKey] = keys.reduce((value, key) => (value !== undefined ? value : node[key]), undefined);
      if (normalized[targetKey] === undefined && fallbackValue !== undefined) {
        normalized[targetKey] = fallbackValue;
      }
    }
  };

  assignIfPresent(["bot_status", "botStatus"], "bot_status", "stopped");
  assignIfPresent(["current_slot", "currentSlot"], "current_slot", null);
  assignIfPresent(["current_proxy", "currentProxy"], "current_proxy", 0);
  assignIfPresent(["proxy_bans", "proxyBans"], "proxy_bans", {});
  assignIfPresent(["cart_items", "cartItems"], "cart_items", null);
  assignIfPresent(["hold_cycle", "holdCycle"], "hold_cycle", 0);
  assignIfPresent(["last_error", "lastError"], "last_error", null);
  assignIfPresent(["last_heartbeat", "lastHeartbeat"], "last_heartbeat", null);
  assignIfPresent(["uptime_seconds", "uptimeSeconds"], "uptime_seconds", 0);
  if (full || Object.prototype.hasOwnProperty.call(node, "extra")) {
    normalized.extra = readNodeExtra(node);
  }

  return normalized;
}

function isMobileViewport() {
  return window.matchMedia("(max-width: 920px)").matches;
}

function applySidebarState() {
  const app = document.getElementById("app");
  const sidebar = document.getElementById("sidebar");
  if (!app || !sidebar) return;

  if (isMobileViewport()) {
    app.classList.remove("sidebar-collapsed");
    sidebar.classList.toggle("open", mobileSidebarOpen);
    return;
  }

  mobileSidebarOpen = false;
  sidebar.classList.remove("open");
  app.classList.toggle("sidebar-collapsed", desktopSidebarCollapsed);
  localStorage.setItem("ts.sidebar.collapsed", desktopSidebarCollapsed ? "1" : "0");
}

function toggleSidebar() {
  if (isMobileViewport()) {
    mobileSidebarOpen = !mobileSidebarOpen;
  } else {
    desktopSidebarCollapsed = !desktopSidebarCollapsed;
  }
  applySidebarState();
}

function handleUnauthorized() {
  if (authExpired) return;
  authExpired = true;
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  if (clockTimer) {
    clearInterval(clockTimer);
    clockTimer = null;
  }
  showLogin();
}

async function syncNodes(force = false) {
  const isFresh = Date.now() - nodesLastSyncAt < 3000;
  if (!force && isFresh) return nodes;
  if (nodesSyncPromise) return nodesSyncPromise;

  nodesSyncPromise = api("/nodes")
    .then((data) => {
      nodes = (data || []).map((node) => normalizeNodeData(node, { full: true }));
      nodesLastSyncAt = Date.now();
      updateStatus();
      return nodes;
    })
    .finally(() => {
      nodesSyncPromise = null;
    });

  return nodesSyncPromise;
}

function requestFreshNodes(pageName) {
  if (currentPage !== pageName) return;
  if (nodesSyncPromise || Date.now() - nodesLastSyncAt < 3000) return;
  void syncNodes(true).then(() => {
    if (currentPage === pageName) {
      renderCurrentPage();
    }
  }).catch(() => {});
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function toast(msg, type = "info") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${escapeHtml(msg)}</span>`;
  document.getElementById("toast-container").appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transition = "opacity 0.3s";
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

function startClock() {
  const el = document.getElementById("topbar-clock");
  if (!el) return;
  const tick = () => {
    el.textContent = new Date().toUTCString().slice(17, 25) + " UTC";
  };
  tick();
  if (clockTimer) clearInterval(clockTimer);
  clockTimer = setInterval(tick, 1000);
}

async function checkAuth() {
  try {
    const d = await api("/auth/check");
    if (d.authenticated) {
      showApp();
      return;
    }
  } catch {}
  showLogin();
}

function showLogin() {
  document.getElementById("login-screen").classList.remove("hidden");
  document.getElementById("app").classList.add("hidden");
}

function showApp() {
  authExpired = false;
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
  applySidebarState();
  connectSocket();
  startClock();
  navigate(location.hash.slice(1) || "dashboard");
}

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector("button");
  btn.textContent = "Входим...";
  btn.disabled = true;
  try {
    await api("/auth/login", {
      method: "POST",
      body: { password: document.getElementById("login-password").value }
    });
    showApp();
  } catch {
    document.getElementById("login-error").textContent = "Неверный пароль";
    btn.textContent = "Войти";
    btn.disabled = false;
  }
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  await api("/auth/logout", { method: "POST" });
  if (clockTimer) clearInterval(clockTimer);
  showLogin();
});

function connectSocket() {
  if (socket) return;
  socket = io();
  socket.on("init", (d) => {
    nodes = (d.nodes || []).map((node) => normalizeNodeData(node, { full: true }));
    nodesLastSyncAt = Date.now();
    renderCurrentPage();
    updateStatus();
  });
  socket.on("node:update", (d) => {
    const normalized = normalizeNodeData({ id: d.nodeId, ...d });
    const index = nodes.findIndex((n) => n.id === d.nodeId);
    if (index >= 0) {
      if (normalized.extra !== undefined) {
        normalized.extra = {
          ...readNodeExtra(nodes[index]),
          ...(typeof normalized.extra === "string" ? readNodeExtra({ extra: normalized.extra }) : (normalized.extra || {}))
        };
      }
      Object.assign(nodes[index], normalized);
    } else {
      nodes.push(normalized);
    }
    if (["dashboard", "group", "underground", "servers", "slots", "payment"].includes(currentPage)) {
      if (!(currentPage === "payment" && activeVncSession)) {
        renderCurrentPage();
      }
    }
    updateStatus();
  });
  socket.on("deploy:progress", (d) => {
    toast(`Узел ${d.nodeId}: ${d.status}`, d.status === "done" ? "success" : d.status === "error" ? "error" : "info");
  });
  socket.on("disconnect", () => toast("Соединение потеряно", "error"));
}

function updateStatus() {
  const online = nodes.filter((n) => {
    const botStatus = n.bot_status || "";
    return n.status === "online" && ["starting", "running", "hold", "checkout", "banned"].includes(botStatus);
  }).length;
  const total = nodes.length;
  const cartCount = nodes.filter(hasActiveCart).length;

  const onlineEl = document.getElementById("online-count");
  const totalEl = document.getElementById("total-count");
  if (onlineEl) onlineEl.textContent = online;
  if (totalEl) totalEl.textContent = total;

  const paymentBadge = document.getElementById("nav-badge-payment");
  if (paymentBadge) {
    paymentBadge.textContent = cartCount;
    paymentBadge.style.display = cartCount > 0 ? "inline-flex" : "none";
  }

  const slotsBadge = document.getElementById("nav-badge-slots");
  if (slotsBadge) {
    slotsBadge.textContent = cartCount;
    slotsBadge.style.display = cartCount > 0 ? "inline-flex" : "none";
  }
}

function navigate(page) {
  currentPage = page || "dashboard";
  location.hash = currentPage;
  if (logTimer) {
    clearInterval(logTimer);
    logTimer = null;
  }
  document.querySelectorAll(".nav-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.page === currentPage);
  });
  const prefix = document.getElementById("page-prefix");
  const title = document.getElementById("page-title-text");
  if (prefix) prefix.textContent = PAGE_PREFIX[currentPage] || "";
  if (title) title.textContent = PAGE_TITLES[currentPage] || currentPage;
  if (isMobileViewport()) {
    mobileSidebarOpen = false;
    applySidebarState();
  }
  renderCurrentPage();
}

document.querySelectorAll(".nav-item").forEach((el) => {
  el.addEventListener("click", (e) => {
    e.preventDefault();
    navigate(el.dataset.page);
  });
});

window.addEventListener("hashchange", () => navigate(location.hash.slice(1)));

function renderCurrentPage() {
  renderRevision += 1;
  const pages = {
    dashboard: renderDashboard,
    group: renderGroup,
    underground: renderUnderground,
    payment: renderPayment,
    servers: renderServers,
    proxies: renderProxies,
    config: renderConfigV2,
    logs: renderLogs,
    slots: renderSlots
  };
  (pages[currentPage] || renderDashboard)();
}

function getNodeMode(n) {
  const extra = readNodeExtra(n);
  if (extra && extra.mode) return extra.mode;
  return "group";
}

const isUnder = (n) => getNodeMode(n) === "underground";
const isGroup = (n) => !isUnder(n);
const hasCart = (n) => !!(n.cart_items && n.cart_items !== "null");
const getCartState = (n) => {
  const extra = readNodeExtra(n);
  if (extra.cartState) return extra.cartState;
  if (["hold", "checkout"].includes(n.bot_status || "")) return n.bot_status;
  return hasCart(n) ? "hold" : "idle";
};
const hasActiveCart = (n) => {
  if (!hasFreshHeartbeat(n) || (n.bot_status || "") === "stopped") return false;
  const cartState = getCartState(n);
  if (cartState === "hold" || cartState === "checkout") return true;
  return hasCart(n) && cartState !== "released" && cartState !== "inactive";
};
const cartStateLabel = (n) => getCartState(n) === "checkout" ? "checkout" : "hold";
const hasFreshHeartbeat = (n) => n.status === "online";
const isOnline = (n) => hasFreshHeartbeat(n) && ["starting", "running", "hold", "checkout", "banned"].includes(n.bot_status || "");
const getRuntimeMode = (n) => readNodeExtra(n).runtimeMode || readNodeExtra(n).mode || "—";
const getRuntimeWindow = (n) => readNodeExtra(n).runtimeWindow || "—";
const fmtSlot = (s) => {
  if (!s) return "—";
  const t = s.split("T")[1];
  return t ? t.replace("Z", "").slice(0, 5) : s;
};
const fmtSlotFull = (s) => (s ? s.replace("T", " ").replace("Z", "").slice(0, 16) : "—");
const trunc = (s, n) => (s && s.length > n ? s.slice(0, n) + "…" : (s || "—"));
const activeError = (n) => !!(n.last_error && /ban|403|waf|payload|tunnel|error/i.test(n.last_error));
const parseMaybeUtc = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return new Date(value.replace(" ", "T") + "Z");
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};
const timeAgo = (d) => {
  const parsed = parseMaybeUtc(d);
  if (!parsed) return "—";
  const seconds = Math.floor((Date.now() - parsed.getTime()) / 1000);
  if (seconds < 10) return "сейчас";
  if (seconds < 60) return `${seconds}с`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}м`;
  return `${Math.floor(seconds / 3600)}ч`;
};
const prettyBot = (s) => s || "unknown";
const plural = (count, one, few, many) => {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
};

function renderHero({ eyebrow, title, copy, chips = [], sideCards = [] }) {
  return `
    <div class="hero">
      <div class="hero-card warm">
        <div class="hero-eyebrow">${escapeHtml(eyebrow)}</div>
        <div class="hero-title">${escapeHtml(title)}</div>
        <div class="hero-copy">${escapeHtml(copy)}</div>
        <div class="hero-meta">
          ${chips.map((chip) => `<div class="hero-meta-chip">${escapeHtml(chip)}</div>`).join("")}
        </div>
      </div>
      <div class="hero-side">
        ${sideCards.map((card) => `
          <div class="hero-side-card surface-card">
            <div class="hero-side-label">${escapeHtml(card.label)}</div>
            <div class="hero-side-value ${card.className || ""}">${escapeHtml(String(card.value))}</div>
            <div class="hero-side-sub">${escapeHtml(card.sub || "")}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function statCard(label, value, sub = "", className = "") {
  return `
    <div class="stat-card">
      <div class="stat-label">${escapeHtml(label)}</div>
      <div class="stat-value ${className}">${escapeHtml(String(value))}</div>
      <div class="stat-sub">${escapeHtml(sub)}</div>
    </div>
  `;
}

function emptyState(text) {
  return `<div class="empty-state">${escapeHtml(text)}</div>`;
}

function summaryRows(list, slotColor = "blue") {
  if (!list.length) return emptyState("Сейчас здесь нет активных записей.");
  return `
    <div class="inline-list">
      ${list.map((n) => `
        <div class="inline-row">
          <div class="inline-row-name">NODE_${String(n.id).padStart(2, "0")}</div>
          <div class="inline-row-slot" style="color:var(--${slotColor})">${escapeHtml(fmtSlot(n.current_slot))}</div>
          <div><span class="badge badge-${n.bot_status || "unknown"}">${escapeHtml(prettyBot(n.bot_status))}</span></div>
        </div>
      `).join("")}
    </div>
  `;
}

function nodeCard(n) {
  const mode = isUnder(n) ? "underground" : "group";
  const activeCart = hasActiveCart(n);
  const cartState = getCartState(n);
  const stateClass = !isOnline(n) ? "offline" : cartState === "checkout" ? "is-checkout" : activeCart ? "has-cart" : "";
  const bot = n.bot_status || "stopped";
  const holdBlock = activeCart
    ? `<div class="node-hold ${cartState === "checkout" ? "checkout" : ""}"><span class="node-hold-slot">${fmtSlotFull(n.current_slot)}</span><span class="node-hold-cycle">цикл #${n.hold_cycle || 0}</span><span class="node-hold-state">${escapeHtml(cartStateLabel(n))}</span></div>`
    : "";
  const payBtn = activeCart
    ? `<button class="btn btn-purple btn-sm" data-action="pay" data-node-id="${n.id}">Оплата</button>`
    : "";
  return `
    <div class="node-card ${stateClass}">
      <div class="node-head">
        <div class="node-name">
          <div class="dot dot-${!isOnline(n) ? "gray" : activeCart ? (cartState === "checkout" ? "green" : "yellow") : "green"}"></div>
          NODE_${String(n.id).padStart(2, "0")}
          <span class="node-tag ${mode}">${mode === "underground" ? "UND" : "GRP"}</span>
        </div>
        <span class="badge badge-${bot}">${escapeHtml(prettyBot(bot))}</span>
      </div>
      <div class="node-ip">${escapeHtml(n.ip || "—")}</div>
      ${holdBlock}
      <div class="node-rows">
        <div class="node-row"><span class="node-row-label">Слот</span><span class="node-row-val">${escapeHtml(fmtSlot(n.current_slot))}</span></div>
        <div class="node-row"><span class="node-row-label">Прокси</span><span class="node-row-val">#${escapeHtml(String(n.current_proxy ?? 0))}</span></div>
        <div class="node-row"><span class="node-row-label">Корзина</span><span class="node-row-val">${escapeHtml(trunc(n.cart_items, 28))}</span></div>
        <div class="node-row"><span class="node-row-label">Heartbeat</span><span class="node-row-val">${escapeHtml(timeAgo(n.last_heartbeat))}</span></div>
        ${n.last_error ? `<div class="node-row"><span class="node-row-label">Ошибка</span><span class="node-row-val err">${escapeHtml(trunc(n.last_error, 42))}</span></div>` : ""}
      </div>
      <div class="node-actions">
        <button class="btn btn-green btn-sm" data-action="start" data-node-id="${n.id}">Старт</button>
        <button class="btn btn-red btn-sm" data-action="stop" data-node-id="${n.id}">Стоп</button>
        <button class="btn btn-ghost btn-sm" data-action="logs" data-node-id="${n.id}">Логи</button>
        ${payBtn}
      </div>
    </div>
  `;
}

function bindNodeActions() {
  document.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const { action, nodeId } = btn.dataset;
      const id = parseInt(nodeId, 10);
      if (action === "start") startNode(id);
      else if (action === "stop") stopNode(id);
      else if (action === "logs") {
        navigate("logs");
        setTimeout(() => selectLogNode(id), 80);
      } else if (action === "pay") {
        navigate("payment");
      }
    });
  });
}

function setFilter(filter) {
  nodeFilter = filter;
  renderDashboard();
}

function getFilteredNodes() {
  return nodes.filter((n) => {
    if (nodeFilter === "cart") return hasActiveCart(n);
    if (nodeFilter === "offline") return !isOnline(n);
    return true;
  });
}

function renderDashboard() {
  requestFreshNodes("dashboard");
  const c = document.getElementById("page-content");
  const online = nodes.filter(isOnline).length;
  const withCart = nodes.filter(hasActiveCart).length;
  const total = nodes.length || 1;
  const problemCount = nodes.filter(activeError).length;
  const problemPct = Math.round((problemCount / total) * 100);
  const groupNodes = nodes.filter(isGroup);
  const undergroundNodes = nodes.filter(isUnder);
  const holdNodes = nodes.filter((n) => n.bot_status === "hold").length;

  c.innerHTML = `
    ${renderHero({
      eyebrow: "Обзор кластера",
      title: "Операционная картина по всем ботам",
      copy: "Главный экран для контроля поиска, удержаний, ошибок и общего состояния кластера.",
      chips: [
        `${online}/${total} онлайн`,
        `${withCart} ${plural(withCart, "корзина", "корзины", "корзин")}`,
        `${holdNodes} hold`,
        `${problemPct}% проблемных нод`
      ],
      sideCards: [
        { label: "Group / Underground", value: `${groupNodes.length} / ${undergroundNodes.length}`, sub: "распределение нод", className: "blue" },
        { label: "Корзины", value: withCart, sub: `${groupNodes.filter(hasActiveCart).length} group и ${undergroundNodes.filter(hasActiveCart).length} underground`, className: "yellow" }
      ]
    })}
    <div class="stats-row">
      ${statCard("Онлайн", online, `из ${total} нод`, "green")}
      ${statCard("Корзины", withCart, "ноды с билетами", "yellow")}
      ${statCard("Ошибки", problemCount, `${problemPct}% кластера`, problemCount > 0 ? "red" : "green")}
      ${statCard("Hold", holdNodes, "активных удержаний", "blue")}
    </div>
    <div class="surface-grid">
      <div class="surface-card">
        <div class="surface-title">Group сейчас <span>${groupNodes.filter(isOnline).length} онлайн</span></div>
        ${summaryRows(groupNodes.filter(hasActiveCart).slice(0, 6), "blue")}
      </div>
      <div class="surface-card">
        <div class="surface-title">Underground сейчас <span>${undergroundNodes.filter(isOnline).length} онлайн</span></div>
        ${summaryRows(undergroundNodes.filter(hasActiveCart).slice(0, 6), "purple")}
      </div>
    </div>
    <div class="surface-grid">
      <div class="surface-card">
        <div class="surface-title">Проблемные ноды <span>${problemCount}</span></div>
        <div class="status-list">
          ${nodes.filter(activeError).slice(0, 6).map((n) => `
            <div class="status-list-row">
              <div>
                <div class="inline-row-name">NODE_${String(n.id).padStart(2, "0")}</div>
                <div class="muted">${escapeHtml(trunc(n.last_error, 72))}</div>
              </div>
              <div><span class="badge badge-error">${escapeHtml(prettyBot(n.bot_status))}</span></div>
            </div>
          `).join("") || emptyState("Критических сигналов сейчас нет.")}
        </div>
      </div>
      <div class="surface-card">
        <div class="surface-title">Активные корзины <span>${withCart}</span></div>
        <div class="status-list">
          ${nodes.filter(hasActiveCart).slice(0, 6).map((n) => `
            <div class="status-list-row">
              <div>
                <div class="inline-row-name">NODE_${String(n.id).padStart(2, "0")}</div>
                <div class="muted">${escapeHtml(trunc(n.cart_items, 54))}</div>
              </div>
              <div class="inline-row-slot">${escapeHtml(fmtSlotFull(n.current_slot))}</div>
            </div>
          `).join("") || emptyState("Сейчас нет активных корзин.")}
        </div>
      </div>
    </div>
    <div class="section">
      <div class="section-title">Все ноды</div>
      <div class="node-grid">${getFilteredNodes().map(nodeCard).join("")}</div>
    </div>
  `;
}
function renderGroup() {
  const c = document.getElementById("page-content");
  const groupNodes = nodes.filter(isGroup);
  const online = groupNodes.filter(isOnline).length;
  const withCart = groupNodes.filter(hasActiveCart).length;
  const problemCount = groupNodes.filter(activeError).length;

  c.innerHTML = `
    ${renderHero({
      eyebrow: "Режим group",
      title: "Обычные билеты",
      copy: "Сводка по нодам, которые ищут стандартные билеты.",
      chips: [`${groupNodes.length} нод`, `${online} онлайн`, `${withCart} с корзиной`],
      sideCards: [
        { label: "Hold", value: groupNodes.filter((n) => n.bot_status === "hold").length, sub: "активные удержания", className: "blue" },
        { label: "Ошибки", value: problemCount, sub: "ноды требуют внимания", className: problemCount > 0 ? "red" : "green" }
      ]
    })}
    <div class="stats-row">
      ${statCard("Онлайн", online, `из ${groupNodes.length}`, "green")}
      ${statCard("Корзины", withCart, "ноды с билетами", "yellow")}
      ${statCard("Ошибки", problemCount, "ноды с ошибками", problemCount > 0 ? "red" : "green")}
      ${statCard("Hold", groupNodes.filter((n) => n.bot_status === "hold").length, "текущие удержания", "blue")}
    </div>
    <div class="section">
      <div class="section-title">Ноды group</div>
      <div class="node-grid">${groupNodes.map(nodeCard).join("")}</div>
    </div>
  `;
  bindNodeActions();
}

function renderUnderground() {
  const c = document.getElementById("page-content");
  const undergroundNodes = nodes.filter(isUnder);
  const online = undergroundNodes.filter(isOnline).length;
  const withCart = undergroundNodes.filter(hasActiveCart).length;
  const problemCount = undergroundNodes.filter(activeError).length;
  const banPct = undergroundNodes.length ? Math.round((problemCount / undergroundNodes.length) * 100) : 0;

  c.innerHTML = `
    ${renderHero({
      eyebrow: "Режим underground",
      title: "Underground поток",
      copy: "Этот сегмент чувствительнее к rate limit и антиботу, поэтому акцент смещён на ошибки и блокировки.",
      chips: [`${undergroundNodes.length} нод`, `${online} онлайн`, `${banPct}% риск`],
      sideCards: [
        { label: "429 / 403", value: `${undergroundNodes.filter((n) => n.last_error && /429/.test(n.last_error)).length} / ${undergroundNodes.filter((n) => n.last_error && /403/.test(n.last_error)).length}`, sub: "rate limit / WAF", className: "purple" },
        { label: "Корзины", value: withCart, sub: "ноды с найденными билетами", className: "yellow" }
      ]
    })}
    <div class="stats-row">
      ${statCard("Онлайн", online, `из ${undergroundNodes.length}`, "green")}
      ${statCard("Корзины", withCart, "ноды с билетами", "yellow")}
      ${statCard("Ошибки", problemCount, `${banPct}% сегмента`, problemCount > 0 ? "red" : "green")}
      ${statCard("429 / 403", `${undergroundNodes.filter((n) => n.last_error && /429/.test(n.last_error)).length} / ${undergroundNodes.filter((n) => n.last_error && /403/.test(n.last_error)).length}`, "rate limit / WAF", "purple")}
    </div>
    <div class="section">
      <div class="section-title">Ноды underground</div>
      <div class="node-grid">${undergroundNodes.map(nodeCard).join("")}</div>
    </div>
  `;
  bindNodeActions();
}

function renderSlots() {
  requestFreshNodes("slots");
  const c = document.getElementById("page-content");
  const slotsData = nodes
    .filter((n) => n.current_slot && hasActiveCart(n))
    .sort((a, b) => (a.current_slot || "").localeCompare(b.current_slot || ""));

  if (!slotsData.length) {
    c.innerHTML = renderHero({
      eyebrow: "Слоты",
      title: "Сейчас активных удержаний нет",
      copy: "Как только хотя бы одна нода удержит слот или перейдёт в checkout, здесь появится сгруппированная картина по времени и датам.",
      chips: ["0 активных слотов"],
      sideCards: [
        { label: "Checkout", value: nodes.filter((n) => n.bot_status === "checkout").length, sub: "ноды в checkout", className: "yellow" },
        { label: "Hold", value: nodes.filter((n) => n.bot_status === "hold").length, sub: "ноды удерживают слот", className: "blue" }
      ]
    });
    return;
  }

  const byDate = {};
  slotsData.forEach((n) => {
    const date = n.current_slot.split("T")[0];
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(n);
  });

  const totalTickets = slotsData.reduce((sum, n) => {
    const match = (n.cart_items || "").match(/qty=(\d+)/);
    return sum + (match ? parseInt(match[1], 10) : 0);
  }, 0);

  let html = `
    ${renderHero({
      eyebrow: "Активные слоты",
      title: "Удержания и checkout по кластеру",
      copy: "Экран показывает все ноды, которые уже держат слот или перешли в checkout.",
      chips: [`${slotsData.length} активных слотов`, `${totalTickets} билетов`],
      sideCards: [
        { label: "Даты", value: Object.keys(byDate).length, sub: "уникальные даты", className: "green" },
        { label: "Checkout", value: nodes.filter((n) => n.bot_status === "checkout").length, sub: "ноды в checkout", className: "yellow" }
      ]
    })}
    <div class="stats-row">
      ${statCard("Слоты", slotsData.length, "удерживаются сейчас", "blue")}
      ${statCard("Билеты", totalTickets, "суммарно в корзинах", "yellow")}
      ${statCard("Даты", Object.keys(byDate).length, "уникальные даты", "green")}
    </div>
  `;

  Object.entries(byDate).forEach(([date, list]) => {
    html += `
      <div class="section">
        <div class="section-title">${escapeHtml(date)} <span>${list.length} слотов</span></div>
        <div class="slot-grid">
          ${list.map((n) => {
            const time = n.current_slot.split("T")[1]?.replace("Z", "") || "";
            const tickets = (n.cart_items || "").match(/qty=(\d+)/)?.[1] || "?";
            return `
              <div class="slot-card">
                <div class="slot-time">${escapeHtml(time.slice(0, 5))}</div>
                <div class="slot-date">${escapeHtml(date)} UTC</div>
                <div class="slot-meta">NODE_${String(n.id).padStart(2, "0")} · ${isUnder(n) ? "underground" : "group"} · ${tickets} билетов · цикл ${n.hold_cycle || 0}</div>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `;
  });

  c.innerHTML = html;
}

function serverCard(n) {
  const online = isOnline(n);
  const mode = isUnder(n) ? "underground" : "group";
  return `
    <div class="server-card">
      <div class="server-head">
        <div class="server-name">
          <div class="dot dot-${online ? "green" : "gray"}"></div>
          NODE_${String(n.id).padStart(2, "0")}
          <span class="node-tag ${mode}">${mode === "underground" ? "UND" : "GRP"}</span>
        </div>
        <span class="badge badge-${n.bot_status || "stopped"}">${escapeHtml(prettyBot(n.bot_status || "stopped"))}</span>
      </div>
      <div class="server-ip">${escapeHtml(n.ip || "—")}</div>
      <div class="server-actions">
        <button class="btn btn-green btn-sm" data-srv-action="start" data-node-id="${n.id}">Старт</button>
        <button class="btn btn-red btn-sm" data-srv-action="stop" data-node-id="${n.id}">Стоп</button>
        <button class="btn btn-ghost btn-sm" data-srv-action="restart" data-node-id="${n.id}">Рестарт</button>
        <button class="btn btn-ghost btn-sm" data-srv-action="logs" data-node-id="${n.id}">Логи</button>
      </div>
    </div>
  `;
}

function renderServers() {
  const c = document.getElementById("page-content");
  const online = nodes.filter(isOnline).length;
  const offline = nodes.filter((n) => !isOnline(n)).length;

  c.innerHTML = `
    ${renderHero({
      eyebrow: "Управление серверами",
      title: "Запуск, стоп и деплой по нодам",
      copy: "Операционный экран для запуска, остановки, рестарта и деплоя.",
      chips: [`${online} онлайн`, `${offline} офлайн`, `${nodes.length} всего`],
      sideCards: [
        { label: "Running", value: nodes.filter((n) => n.bot_status === "running").length, sub: "боты ищут", className: "green" },
        { label: "Stopped", value: nodes.filter((n) => (n.bot_status || "stopped") === "stopped").length, sub: "боты остановлены", className: offline > 0 ? "red" : "blue" }
      ]
    })}
    <div class="stats-row">
      ${statCard("Онлайн", online, "боты активны", "green")}
      ${statCard("Офлайн", offline, "узлы требуют проверки", offline > 0 ? "red" : "green")}
      ${statCard("Всего", nodes.length, "в кластере", "blue")}
    </div>
    <div class="section">
      <div class="section-title">Массовые действия</div>
      <div class="action-row">
        <button class="btn btn-green" id="srv-start-all">Запустить все</button>
        <button class="btn btn-red" id="srv-stop-all">Остановить все</button>
        <button class="btn btn-blue" id="srv-deploy-all">Деплой кода</button>
        <button class="btn btn-ghost" id="srv-sidecar">Активировать Sidecar</button>
      </div>
    </div>
    <div class="section">
      <div class="section-title">Все серверы</div>
      <div class="server-grid">${nodes.map(serverCard).join("")}</div>
    </div>
  `;

  document.getElementById("srv-start-all")?.addEventListener("click", async () => {
    if (!confirm("Запустить всех ботов?")) return;
    try {
      toast("Запуск...", "info");
      await api("/nodes/start-all", { method: "POST" });
      toast("Все запущены", "success");
    } catch (e) {
      toast(e.message, "error");
    }
  });

  document.getElementById("srv-stop-all")?.addEventListener("click", async () => {
    if (!confirm("Остановить всех ботов?")) return;
    try {
      await api("/nodes/stop-all", { method: "POST" });
      toast("Все остановлены", "success");
    } catch (e) {
      toast(e.message, "error");
    }
  });

  document.getElementById("srv-deploy-all")?.addEventListener("click", deployAll);
  document.getElementById("srv-sidecar")?.addEventListener("click", deploySidecarAll);

  document.querySelectorAll("[data-srv-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const { srvAction, nodeId } = btn.dataset;
      const id = parseInt(nodeId, 10);
      if (srvAction === "start") await startNode(id);
      else if (srvAction === "stop") await stopNode(id);
      else if (srvAction === "restart") {
        await stopNode(id);
        setTimeout(() => startNode(id), 2000);
      } else if (srvAction === "logs") {
        navigate("logs");
        setTimeout(() => selectLogNode(id), 80);
      }
    });
  });
}

function renderLogs() {
  const revision = renderRevision;
  const c = document.getElementById("page-content");
  const options = nodes
    .map((n) => `<option value="${n.id}">NODE_${String(n.id).padStart(2, "0")} (${escapeHtml(n.ip)}) [${isUnder(n) ? "UND" : "GRP"}]</option>`)
    .join("");

  c.innerHTML = `
    ${renderHero({
      eyebrow: "Логи",
      title: "Живой хвост логов по нодам",
      copy: "Экран для быстрой диагностики. Здесь видно источник, состояние процесса, heartbeat и свежесть самого log-файла.",
      chips: [`${nodes.length} нод доступно`, logAutoRefresh ? "автообновление включено" : "автообновление выключено"],
      sideCards: [
        { label: "Автообновление", value: logAutoRefresh ? "ON" : "OFF", sub: "обновление раз в 10 секунд", className: logAutoRefresh ? "green" : "blue" },
        { label: "Выбранная нода", value: currentLogNodeId ? `NODE_${String(currentLogNodeId).padStart(2, "0")}` : "—", sub: "текущий источник лога", className: "yellow" }
      ]
    })}
    <div class="section">
      <div class="log-bar">
        <select id="log-sel">
          <option value="">Выберите узел</option>
          ${options}
        </select>
        <input type="text" id="log-search-inp" placeholder="Поиск по логам" value="${escapeHtml(logSearch)}">
        <select id="log-filter">
          <option value="all">Все</option>
          <option value="errors">Ошибки</option>
          <option value="success">Успехи</option>
          <option value="cart">Корзина</option>
        </select>
        <button class="btn btn-ghost btn-sm" id="log-refresh-btn">Обновить</button>
        <label class="log-auto"><input type="checkbox" id="log-auto-chk" ${logAutoRefresh ? "checked" : ""}> Авто 10с</label>
      </div>
    </div>
    <div class="section" id="log-meta-box"><div class="muted">Выберите узел для чтения лога.</div></div>
    <div class="log-box" id="log-box">Выберите узел для чтения лога.</div>
  `;

  const sel = document.getElementById("log-sel");
  if (currentLogNodeId) sel.value = String(currentLogNodeId);
  sel.addEventListener("change", (e) => {
    if (e.target.value) loadLogs(parseInt(e.target.value, 10));
  });
  document.getElementById("log-refresh-btn")?.addEventListener("click", () => {
    const value = sel.value;
    if (value) loadLogs(parseInt(value, 10));
  });
  document.getElementById("log-search-inp")?.addEventListener("input", (e) => {
    logSearch = e.target.value;
    if (sel.value) loadLogs(parseInt(sel.value, 10));
  });
  document.getElementById("log-filter")?.addEventListener("change", () => {
    if (sel.value) loadLogs(parseInt(sel.value, 10));
  });
  document.getElementById("log-auto-chk")?.addEventListener("change", (e) => {
    logAutoRefresh = e.target.checked;
    if (logTimer) clearInterval(logTimer);
    if (logAutoRefresh) {
      logTimer = setInterval(() => {
        if (sel.value) loadLogs(parseInt(sel.value, 10));
      }, 10000);
    }
  });
  if (currentLogNodeId && revision === renderRevision && currentPage === "logs") loadLogs(currentLogNodeId);
}

function selectLogNode(id) {
  currentLogNodeId = id;
  const sel = document.getElementById("log-sel");
  if (sel) {
    sel.value = String(id);
    loadLogs(id);
  }
}

function formatLogMeta(meta, node) {
  const staleBadge = meta?.isStale
    ? `<span class="badge badge-error">stale</span>`
    : '';
  const source = meta?.source === "fallback" ? "fallback" : "ssh";
  const processState = meta?.processState || "UNKNOWN";
  const heartbeat = meta?.lastHeartbeat ? timeAgo(meta.lastHeartbeat) : "—";
  const updated = meta?.mtimeMs ? new Date(meta.mtimeMs).toLocaleTimeString("ru-RU") : "—";
  const sizeKb = meta?.sizeBytes ? `${Math.round(meta.sizeBytes / 1024)} KB` : "0 KB";
  const nodeStatus = meta?.nodeStatus || node?.status || "unknown";
  const botStatus = meta?.botStatus || node?.bot_status || "unknown";

  const parts = [
    staleBadge,
    `<span class="badge badge-${botStatus}">${escapeHtml(botStatus)}</span>`,
    `<span class="badge badge-${nodeStatus}">${escapeHtml(nodeStatus)}</span>`,
    `<span>Источник: <b>${escapeHtml(source)}</b></span>`,
    `<span>Процесс: <b>${escapeHtml(processState)}</b></span>`,
    meta?.processId ? `<span>PID: <b>${escapeHtml(String(meta.processId))}</b></span>` : '',
    `<span>Heartbeat: <b>${escapeHtml(heartbeat)}</b></span>`,
    `<span>Лог обновлён: <b>${escapeHtml(updated)}</b></span>`,
    `<span>Размер: <b>${escapeHtml(sizeKb)}</b></span>`,
    meta?.logPath ? `<span>Путь: <b>${escapeHtml(meta.logPath)}</b></span>` : ''
  ].filter(Boolean);

  if (meta?.lastError) {
    parts.push(`<span style="color:var(--red)">Ошибка: ${escapeHtml(meta.lastError)}</span>`);
  }

  if (meta?.isStale) {
    const reasonMap = {
      no_log_file: 'процесс запущен, но log-файл не найден',
      heartbeat_ahead_of_log: 'heartbeat новее лог-файла',
      log_not_updating: 'лог давно не обновлялся'
    };
    parts.push(`<span style="color:var(--red)">Лог неактуален: ${escapeHtml(reasonMap[meta.staleReason] || meta.staleReason || 'unknown')}</span>`);
  }

  return `<div class="log-meta">${parts.join('<span class="log-meta-sep">|</span>')}</div>`;
}

async function loadLogs(id) {
  const revision = renderRevision;
  const box = document.getElementById("log-box");
  const metaBox = document.getElementById("log-meta-box");
  if (!box) return;
  currentLogNodeId = id;
  const node = nodes.find((n) => n.id === id);
  try {
    const data = await api(`/logs/${id}?lines=400`);
    if (revision !== renderRevision || currentPage !== "logs") return;
    if (metaBox) metaBox.innerHTML = formatLogMeta(data.meta || {}, node);
    const filter = document.getElementById("log-filter")?.value || "all";
    if (data.error) {
      box.innerHTML = `<span class="le">SSH недоступен: ${escapeHtml(data.error)}</span>`;
      return;
    }
    box.innerHTML = colorizeLogs(data.log || "Лог пуст", logSearch, filter);
    box.scrollTop = box.scrollHeight;
  } catch (e) {
    if (metaBox) metaBox.innerHTML = `<span style="color:var(--red)">Не удалось загрузить лог: ${escapeHtml(e.message)}</span>`;
    box.textContent = `Ошибка: ${e.message}`;
  }
}

function colorizeLogs(text, search = "", filter = "all") {
  return text
    .split("\n")
    .filter((line) => {
      if (!line.trim()) return false;
      if (filter === "errors" && !/WAF|403|banned|ошиб|error|payload/i.test(line)) return false;
      if (filter === "success" && !/success|добавлен|успех|checkout/i.test(line)) return false;
      if (filter === "cart" && !/корзин|addtocart|cart|qty=/i.test(line)) return false;
      return true;
    })
    .map((line) => {
      let cls = "";
      if (/WAF|hard_blocked|ошиб|error|payload miss|ERR_/i.test(line)) cls = "le";
      else if (/success|добавлен|checkout|реальный успех/i.test(line)) cls = "ls";
      else if (/HOLD|RE-CATCH/i.test(line)) cls = "lh";
      else if (/429|403|бан|pause/i.test(line)) cls = "lw";
      else if (/api|proxy|page\.goto|payload/i.test(line)) cls = "li";
      let escaped = escapeHtml(line);
      if (search && search.length > 1) {
        const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
        escaped = escaped.replace(re, (m) => `<span class="lm">${m}</span>`);
      }
      return cls ? `<span class="${cls}">${escaped}</span>` : escaped;
    })
    .join("\n");
}

function getTargetByMode(cfg, mode) {
  const targets = cfg.targets || [];
  return targets.find((t) => t.type === mode) || targets.find((t) => t.type === "group") || targets[0] || null;
}

function getWindowValues(entry) {
  if (!entry) return { start: "", end: "" };
  if (entry.target_datetime_start || entry.target_datetime_end) {
    return { start: entry.target_datetime_start || "", end: entry.target_datetime_end || "" };
  }
  const startDate = entry.target_date_start || entry.target_date || "";
  const endDate = entry.target_date_end || entry.target_date || "";
  const startTime = entry.time_range?.start || "";
  const endTime = entry.time_range?.end || "";
  return {
    start: startDate && startTime ? `${startDate}T${startTime}` : "",
    end: endDate && endTime ? `${endDate}T${endTime}` : ""
  };
}

function getEffectiveConfigSummary(cfg, nodeId) {
  const selectedNodeId = String(nodeId);
  const override = cfg.nodeOverrides?.[selectedNodeId] || {};
  const mode = override.mode || cfg.application?.mode || "group";
  const baseTarget = getTargetByMode(cfg, mode) || {};
  const baseWindow = getWindowValues(baseTarget);
  const overrideWindow = getWindowValues(override);
  const effectiveWindow = {
    start: overrideWindow.start || baseWindow.start || "",
    end: overrideWindow.end || baseWindow.end || ""
  };
  const source = (overrideWindow.start || overrideWindow.end || override.mode || override.tickets?.length)
    ? "override"
    : "global";

  return {
    nodeId: Number(selectedNodeId),
    mode,
    source,
    effectiveWindow,
    override,
    baseWindow
  };
}

function sanitizeParticipants(participants) {
  return (participants || [])
    .map((participant) => ({
      firstName: String(participant?.firstName || "").trim(),
      lastName: String(participant?.lastName || "").trim(),
      type: ["adult", "child", "guide"].includes(participant?.type) ? participant.type : "adult"
    }))
    .filter((participant) => participant.firstName || participant.lastName);
}

function sanitizeTickets(tickets) {
  return (tickets || [])
    .map((ticket) => {
      const quantity = Math.max(0, parseInt(ticket?.quantity, 10) || 0);
      return {
        ...ticket,
        label: String(ticket?.label || "").trim(),
        quantity,
        row: ticket?.row === undefined || ticket?.row === null ? "" : String(ticket.row)
      };
    })
    .filter((ticket) => ticket.label);
}

function cleanupScheduleFields(target) {
  delete target.target_date;
  delete target.target_date_start;
  delete target.target_date_end;
  delete target.target_datetime_start;
  delete target.target_datetime_end;
  delete target.time_range;
  delete target.rolling_days_ahead;
  delete target.rolling_days_count;
  return target;
}

function pruneOverride(override) {
  const next = { ...override };
  Object.keys(next).forEach((key) => {
    const value = next[key];
    if (value === undefined || value === null || value === "") delete next[key];
    if (Array.isArray(value) && value.length === 0) delete next[key];
    if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) delete next[key];
  });
  return next;
}

function renderParticipantRows(participants) {
  const rows = sanitizeParticipants(participants);
  const source = rows.length > 0 ? rows : [{ firstName: "", lastName: "", type: "adult" }];
  return source.map((participant) => `
    <tr>
      <td><input class="cfg-first-name" type="text" value="${escapeAttr(participant.firstName)}"></td>
      <td><input class="cfg-last-name" type="text" value="${escapeAttr(participant.lastName)}"></td>
      <td>
        <select class="cfg-participant-type">
          <option value="adult" ${participant.type === "adult" ? "selected" : ""}>adult</option>
          <option value="child" ${participant.type === "child" ? "selected" : ""}>child</option>
          <option value="guide" ${participant.type === "guide" ? "selected" : ""}>guide</option>
        </select>
      </td>
      <td><button class="btn btn-ghost cfg-remove-row" type="button">Remove</button></td>
    </tr>
  `).join("");
}

function renderTicketRows(tickets) {
  const rows = sanitizeTickets(tickets);
  const source = rows.length > 0 ? rows : [{ label: "", quantity: 1, row: "" }];
  return source.map((ticket) => `
    <tr data-origin="${escapeAttr(JSON.stringify(ticket))}">
      <td><input class="cfg-ticket-label" type="text" value="${escapeAttr(ticket.label)}"></td>
      <td><input class="cfg-ticket-quantity" type="number" min="0" value="${escapeAttr(ticket.quantity)}"></td>
      <td><input class="cfg-ticket-row" type="text" value="${escapeAttr(ticket.row || "")}"></td>
      <td><button class="btn btn-ghost cfg-remove-row" type="button">Remove</button></td>
    </tr>
  `).join("");
}

function readParticipantsTable(tableId) {
  const table = document.getElementById(tableId);
  if (!table) return [];
  const rows = Array.from(table.querySelectorAll("tbody tr"));
  return sanitizeParticipants(rows.map((row) => ({
    firstName: row.querySelector(".cfg-first-name")?.value || "",
    lastName: row.querySelector(".cfg-last-name")?.value || "",
    type: row.querySelector(".cfg-participant-type")?.value || "adult"
  })));
}

function readTicketsTable(tableId) {
  const table = document.getElementById(tableId);
  if (!table) return [];
  const rows = Array.from(table.querySelectorAll("tbody tr"));
  return sanitizeTickets(rows.map((row) => {
    let origin = {};
    try {
      origin = JSON.parse(row.getAttribute("data-origin") || "{}");
    } catch {}
    return {
      ...origin,
      label: row.querySelector(".cfg-ticket-label")?.value || "",
      quantity: row.querySelector(".cfg-ticket-quantity")?.value || 0,
      row: row.querySelector(".cfg-ticket-row")?.value || ""
    };
  }));
}

function addParticipantRow(tableId) {
  const tbody = document.querySelector(`#${tableId} tbody`);
  if (!tbody) return;
  tbody.insertAdjacentHTML("beforeend", `
    <tr>
      <td><input class="cfg-first-name" type="text" value=""></td>
      <td><input class="cfg-last-name" type="text" value=""></td>
      <td>
        <select class="cfg-participant-type">
          <option value="adult" selected>adult</option>
          <option value="child">child</option>
          <option value="guide">guide</option>
        </select>
      </td>
      <td><button class="btn btn-ghost cfg-remove-row" type="button">Remove</button></td>
    </tr>
  `);
}

function addTicketRow(tableId) {
  const tbody = document.querySelector(`#${tableId} tbody`);
  if (!tbody) return;
  tbody.insertAdjacentHTML("beforeend", `
    <tr data-origin="{}">
      <td><input class="cfg-ticket-label" type="text" value=""></td>
      <td><input class="cfg-ticket-quantity" type="number" min="0" value="1"></td>
      <td><input class="cfg-ticket-row" type="text" value=""></td>
      <td><button class="btn btn-ghost cfg-remove-row" type="button">Remove</button></td>
    </tr>
  `);
}

function bindConfigTableActions() {
  document.querySelectorAll(".cfg-add-row").forEach((button) => {
    button.addEventListener("click", () => {
      const tableId = button.dataset.target;
      if (button.dataset.kind === "participant") addParticipantRow(tableId);
      if (button.dataset.kind === "ticket") addTicketRow(tableId);
    });
  });

  document.querySelectorAll(".cfg-table").forEach((table) => {
    table.addEventListener("click", (event) => {
      const removeButton = event.target.closest(".cfg-remove-row");
      if (!removeButton) return;
      const row = removeButton.closest("tr");
      const tbody = row?.parentElement;
      row?.remove();
      if (tbody && tbody.children.length === 0) {
        if (table.dataset.kind === "participants") addParticipantRow(table.id);
        if (table.dataset.kind === "tickets") addTicketRow(table.id);
      }
    });
  });
}

function applyStatusBadge(status) {
  const className = {
    applied: "badge-green",
    synced_but_unconfirmed: "badge-blue",
    synced_no_process: "badge-warn",
    ssh_error: "badge-red"
  }[status] || "badge-ghost";
  return `<span class="badge ${className}">${escapeHtml(status || "unknown")}</span>`;
}

function renderConfigApplyResult(result) {
  if (!result || !Array.isArray(result.results) || result.results.length === 0) return "";
  return `
    <div class="section">
      <div class="section-title">Результат применения</div>
      <div class="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Node</th>
              <th>Status</th>
              <th>Sync</th>
              <th>Signal</th>
              <th>Confirm</th>
              <th>Version</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            ${result.results.map((item) => `
              <tr>
                <td>NODE_${String(item.nodeId).padStart(2, "0")}</td>
                <td>${applyStatusBadge(item.status)}</td>
                <td>${item.sync?.ok ? "ok" : "fail"}</td>
                <td>${item.signal?.ok ? "ok" : (item.signal?.status || "fail")}</td>
                <td>${item.confirm?.ok ? "ok" : "no"}</td>
                <td>${escapeHtml(String(item.version || result.version || ""))}</td>
                <td>${escapeHtml(item.error || item.confirm?.error || item.signal?.error || item.sync?.error || "")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderConfig() {
  requestFreshNodes("config");
  const revision = renderRevision;
  const c = document.getElementById("page-content");
  c.innerHTML = '<div class="section"><div class="section-title">Загрузка...</div></div>';

  api("/config").then((cfg) => {
    if (revision !== renderRevision || currentPage !== "config") return;
    const globalMode = cfg.application?.mode || "group";
    const globalTarget = getTargetByMode(cfg, globalMode) || {};
    const globalWindow = getWindowValues(globalTarget);
    const globalQty = getPrimaryTicketQuantity(globalTarget.tickets, globalMode);
    const partsText = (cfg.participants || []).map((p) => `${p.firstName || ""} ${p.lastName || ""}`.trim()).join("\n");

    const selectedNodeId = configEditorNodeId;
    const selectedOverride = cfg.nodeOverrides?.[String(selectedNodeId)] || {};
    const singleMode = selectedOverride.mode || globalMode;
    const singleTarget = getTargetByMode(cfg, singleMode) || globalTarget;
    const singleWindowRaw = getWindowValues(selectedOverride);
    const singleWindow = {
      start: singleWindowRaw.start || globalWindow.start,
      end: singleWindowRaw.end || globalWindow.end
    };
    const singleQty = getPrimaryTicketQuantity(selectedOverride.tickets, singleMode) || getPrimaryTicketQuantity(singleTarget.tickets, singleMode) || globalQty;

    c.innerHTML = `
      ${renderHero({
        eyebrow: "Конфигурация",
        title: "Общий и одиночный режим",
        copy: "Интерфейс разделён на два понятных сценария: общая настройка для всех и точечный override для одной ноды.",
        chips: [configEditorScope === "global" ? "общий режим" : `NODE_${String(selectedNodeId).padStart(2, "0")}`, `mode: ${globalMode}`, cfg.application?.holdMode ? "hold включён" : "hold выключен"],
        sideCards: [
          { label: "Режим редактора", value: configEditorScope === "global" ? "GLOBAL" : "SINGLE", sub: "текущий способ редактирования", className: "blue" },
          { label: "Участники", value: (cfg.participants || []).length, sub: "список участников в конфиге", className: "green" }
        ]
      })}
      <div class="section">
        <div class="section-title">Режим настройки</div>
        <div class="config-mode-card">
          <div class="form-group">
            <label>Редактор</label>
            <select id="cfg-scope">
              <option value="global" ${configEditorScope === "global" ? "selected" : ""}>Общий режим</option>
              <option value="single" ${configEditorScope === "single" ? "selected" : ""}>Одиночный режим</option>
            </select>
          </div>
          <div class="form-group" ${configEditorScope === "single" ? "" : 'style="display:none"'}>
            <label>Узел</label>
            <select id="cfg-node-select">
              ${Array.from({ length: 31 }, (_, index) => index + 1).map((id) => `
                <option value="${id}" ${id === selectedNodeId ? "selected" : ""}>NODE_${String(id).padStart(2, "0")}</option>
              `).join("")}
            </select>
          </div>
        </div>
      </div>

      <div class="section" ${configEditorScope === "global" ? "" : 'style="display:none"'}>
        <div class="section-title">Общий режим</div>
        <div class="form-row">
          <div class="form-group">
            <label>Режим ботов</label>
            <select id="cfg-mode">
              <option value="group" ${globalMode === "group" ? "selected" : ""}>Group</option>
              <option value="underground" ${globalMode === "underground" ? "selected" : ""}>Underground</option>
            </select>
          </div>
          <div class="form-group">
            <label>Hold mode</label>
            <select id="cfg-hold">
              <option value="true" ${cfg.application?.holdMode ? "selected" : ""}>Включён</option>
              <option value="false" ${!cfg.application?.holdMode ? "selected" : ""}>Выключен</option>
            </select>
          </div>
          <div class="form-group">
            <label>Количество билетов</label>
            <input type="number" id="cfg-global-qty" min="1" max="30" value="${globalQty || 24}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Ищем с</label>
            <input type="datetime-local" id="cfg-global-start" value="${globalWindow.start || ""}">
          </div>
          <div class="form-group">
            <label>Ищем до</label>
            <input type="datetime-local" id="cfg-global-end" value="${globalWindow.end || ""}">
          </div>
        </div>
        <div class="form-group">
          <label>Участники</label>
          <textarea id="cfg-parts" spellcheck="false">${escapeHtml(partsText)}</textarea>
        </div>
      </div>

      <div class="section" ${configEditorScope === "single" ? "" : 'style="display:none"'}>
        <div class="section-title">Override одной ноды</div>
        <div class="config-hint">NODE_${String(selectedNodeId).padStart(2, "0")} получит свой override. Остальные ноды останутся на общем режиме.</div>
        <div class="form-row">
          <div class="form-group">
            <label>Режим ноды</label>
            <select id="cfg-single-mode">
              <option value="group" ${singleMode === "group" ? "selected" : ""}>Group</option>
              <option value="underground" ${singleMode === "underground" ? "selected" : ""}>Underground</option>
            </select>
          </div>
          <div class="form-group">
            <label>Количество билетов</label>
            <input type="number" id="cfg-single-qty" min="1" max="30" value="${singleQty || 24}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Ищем с</label>
            <input type="datetime-local" id="cfg-single-start" value="${singleWindow.start || ""}">
          </div>
          <div class="form-group">
            <label>Ищем до</label>
            <input type="datetime-local" id="cfg-single-end" value="${singleWindow.end || ""}">
          </div>
        </div>
        <div class="action-row">
          <button class="btn btn-ghost" id="cfg-clear-single">Сбросить override ноды</button>
        </div>
      </div>

      <div class="action-row">
        <button class="btn btn-primary" id="cfg-save">Сохранить</button>
        <button class="btn btn-blue" id="cfg-deploy">Сохранить и деплой</button>
        <button class="btn btn-green" id="cfg-restart">Сохранить и перезапустить</button>
      </div>
    `;

    document.getElementById("cfg-scope")?.addEventListener("change", (e) => {
      configEditorScope = e.target.value;
      renderConfig();
    });
    document.getElementById("cfg-node-select")?.addEventListener("change", (e) => {
      configEditorNodeId = parseInt(e.target.value, 10) || 12;
      renderConfig();
    });
    document.getElementById("cfg-save")?.addEventListener("click", () => saveConfig(cfg));
    document.getElementById("cfg-deploy")?.addEventListener("click", async () => {
      await saveConfig(cfg);
      deployAll();
    });
    document.getElementById("cfg-clear-single")?.addEventListener("click", async () => {
      const next = JSON.parse(JSON.stringify(cfg));
      next.nodeOverrides = next.nodeOverrides || {};
      delete next.nodeOverrides[String(configEditorNodeId)];
      await api("/config", { method: "PUT", body: next });
      toast(`Override NODE_${configEditorNodeId} удалён`, "success");
      renderConfig();
    });
    document.getElementById("cfg-restart")?.addEventListener("click", async () => {
      await saveConfig(cfg);
      const nodeIds = configEditorScope === "single" ? [configEditorNodeId] : [];
      const label = nodeIds.length > 0 ? `NODE_${String(nodeIds[0]).padStart(2, "0")}` : "все ноды";
      if (!confirm(`Перезапустить ${label}?`)) return;
      try {
        toast(`Перезапуск: ${label}...`, "info");
        const result = await api("/config/restart", { method: "POST", body: { nodeIds } });
        const ok = result.results.filter((x) => x.ok).length;
        const fail = result.results.filter((x) => !x.ok).length;
        toast(`Перезапущено: ${ok}${fail > 0 ? `, ошибок: ${fail}` : ""}`, fail > 0 ? "error" : "success");
      } catch (e) {
        toast(e.message, "error");
      }
    });
  }).catch((e) => {
    if (revision !== renderRevision || currentPage !== "config") return;
    c.innerHTML = `<div class="section"><div class="section-title">Ошибка</div><div class="muted">${escapeHtml(e.message)}</div></div>`;
  });
}

async function saveConfig(base) {
  try {
    const cfg = JSON.parse(JSON.stringify(base || await api("/config")));
    cfg.application = cfg.application || {};
    cfg.targets = cfg.targets || [];
    cfg.nodeOverrides = cfg.nodeOverrides || {};

    if (configEditorScope === "global") {
      const mode = document.getElementById("cfg-mode").value;
      const holdMode = document.getElementById("cfg-hold").value === "true";
      const start = document.getElementById("cfg-global-start").value;
      const end = document.getElementById("cfg-global-end").value;
      const qty = document.getElementById("cfg-global-qty").value;
      if (!start || !end) throw new Error("Укажи точное окно поиска");

      cfg.application.mode = mode;
      cfg.application.holdMode = holdMode;

      const activeTarget = getTargetByMode(cfg, mode);
      if (!activeTarget) throw new Error("Не найден target для выбранного режима");
      cleanupScheduleFields(activeTarget);
      activeTarget.target_datetime_start = start;
      activeTarget.target_datetime_end = end;
      activeTarget.tickets = buildTickets(mode, qty, activeTarget.tickets || []);

      const cleanedOverrides = {};
      Object.entries(cfg.nodeOverrides).forEach(([nodeId, override]) => {
        const next = { ...override };
        cleanupScheduleFields(next);
        delete next.mode;
        delete next.tickets;
        const pruned = pruneOverride(next);
        if (Object.keys(pruned).length > 0) cleanedOverrides[nodeId] = pruned;
      });
      cfg.nodeOverrides = cleanedOverrides;
      cfg.participants = parseParticipants((document.getElementById("cfg-parts")?.value || "").trim());
    } else {
      const nodeId = String(configEditorNodeId);
      const mode = document.getElementById("cfg-single-mode").value;
      const start = document.getElementById("cfg-single-start").value;
      const end = document.getElementById("cfg-single-end").value;
      const qty = document.getElementById("cfg-single-qty").value;
      if (!start || !end) throw new Error("Укажи точное окно поиска для выбранной ноды");

      const target = getTargetByMode(cfg, mode) || {};
      const nextOverride = { ...(cfg.nodeOverrides[nodeId] || {}) };
      cleanupScheduleFields(nextOverride);
      nextOverride.mode = mode;
      nextOverride.target_datetime_start = start;
      nextOverride.target_datetime_end = end;
      nextOverride.tickets = buildTickets(mode, qty, nextOverride.tickets?.length ? nextOverride.tickets : (target.tickets || []));
      cfg.nodeOverrides[nodeId] = pruneOverride(nextOverride);
    }

    await api("/config", { method: "PUT", body: cfg });
    toast("Сохранено", "success");
  } catch (e) {
    toast(e.message, "error");
    throw e;
  }
}

function renderConfigV2() {
  const revision = renderRevision;
  const c = document.getElementById("page-content");
  c.innerHTML = '<div class="section"><div class="section-title">Loading...</div></div>';

  api("/config").then((cfg) => {
    if (revision !== renderRevision || currentPage !== "config") return;

    const meta = cfg.configMeta || {};
    const globalMode = cfg.application?.mode || "group";
    const globalTarget = getTargetByMode(cfg, globalMode) || {};
    const globalWindow = getWindowValues(globalTarget);
    const participants = sanitizeParticipants(cfg.participants || []);
    const globalTickets = sanitizeTickets(globalTarget.tickets || []);

    const selectedNodeId = configEditorNodeId;
    const selectedOverride = cfg.nodeOverrides?.[String(selectedNodeId)] || {};
    const effectiveConfig = getEffectiveConfigSummary(cfg, selectedNodeId);
    const runtimeNode = nodes.find((node) => node.id === selectedNodeId) || null;
    const runtimeMode = runtimeNode ? getRuntimeMode(runtimeNode) : "—";
    const runtimeWindow = runtimeNode ? getRuntimeWindow(runtimeNode) : "—";
    const singleMode = selectedOverride.mode || globalMode;
    const singleTarget = getTargetByMode(cfg, singleMode) || globalTarget;
    const singleWindowRaw = getWindowValues(selectedOverride);
    const singleWindow = {
      start: singleWindowRaw.start || globalWindow.start,
      end: singleWindowRaw.end || globalWindow.end
    };
    const singleTickets = sanitizeTickets(selectedOverride.tickets?.length ? selectedOverride.tickets : (singleTarget.tickets || []));

    c.innerHTML = `
      ${renderHero({
        eyebrow: "Конфигурация",
        title: "Черновик, apply и restart разделены",
        copy: "Черновик сохраняется отдельно. Apply без рестарта синхронизирует config.json по нодам и ждёт подтверждение hot reload в логах.",
        chips: [
          configEditorScope === "global" ? "общий режим" : `NODE_${String(selectedNodeId).padStart(2, "0")}`,
          `mode: ${globalMode}`,
          cfg.application?.holdMode ? "hold включён" : "hold выключен"
        ],
        sideCards: [
          { label: "Версия", value: meta.version || 0, sub: meta.updatedAt || "not saved yet", className: "blue" },
          { label: "Участники", value: participants.length, sub: "typed editor без потери type", className: "green" },
          { label: "Билеты", value: globalTickets.length, sub: "редактируется полный tickets-массив", className: "amber" }
        ]
      })}

      <div class="section">
        <div class="section-title">Режим настройки</div>
        <div class="config-mode-card">
          <div class="form-group">
            <label>Редактор</label>
            <select id="cfg-scope">
              <option value="global" ${configEditorScope === "global" ? "selected" : ""}>Общий режим</option>
              <option value="single" ${configEditorScope === "single" ? "selected" : ""}>Одиночный режим</option>
            </select>
          </div>
          <div class="form-group" ${configEditorScope === "single" ? "" : 'style="display:none"'}>
            <label>Узел</label>
            <select id="cfg-node-select">
              ${Array.from({ length: 31 }, (_, index) => index + 1).map((id) => `
                <option value="${id}" ${id === selectedNodeId ? "selected" : ""}>NODE_${String(id).padStart(2, "0")}</option>
              `).join("")}
            </select>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Эффективная конфигурация узла <span>NODE_${String(selectedNodeId).padStart(2, "0")}</span></div>
        <div class="status-grid">
          <div class="surface-card">
            <div class="surface-title">Источник настроек</div>
            <div class="hero-side-value ${effectiveConfig.source === "override" ? "yellow" : "blue"}">${effectiveConfig.source === "override" ? "OVERRIDE" : "GLOBAL"}</div>
            <div class="hero-side-sub">
              ${effectiveConfig.source === "override"
                ? "Узел использует собственный override и не наследует только общий target."
                : "Узел не имеет собственного override и наследует общий target для текущего режима."}
            </div>
          </div>
          <div class="surface-card">
            <div class="surface-title">Эффективный режим</div>
            <div class="hero-side-value green">${escapeHtml(effectiveConfig.mode.toUpperCase())}</div>
            <div class="hero-side-sub">Именно этот mode сейчас должен использоваться на выбранной ноде.</div>
          </div>
          <div class="surface-card">
            <div class="surface-title">Эффективное окно</div>
            <div class="hero-side-value blue" style="font-size:1.2rem">${escapeHtml((effectiveConfig.effectiveWindow.start || "—") + " → " + (effectiveConfig.effectiveWindow.end || "—"))}</div>
            <div class="hero-side-sub">Это итоговое окно после объединения общего target и node override.</div>
          </div>
          <div class="surface-card">
            <div class="surface-title">Подтверждено ботом</div>
            <div class="hero-side-value green" style="font-size:1.1rem">${escapeHtml(`${runtimeMode} / ${runtimeWindow}`)}</div>
            <div class="hero-side-sub">${runtimeNode ? "Runtime на ноде подтверждён по heartbeat/logs." : "Heartbeat для ноды ещё не пришёл."}</div>
          </div>
        </div>
        <div class="config-hint" style="margin-top:14px">
          Пустой <code>nodeOverride.datetime</code> в логах не означает ошибку применения. Для узлов без override окно берётся из общего target режима <code>${escapeHtml(effectiveConfig.mode)}</code>.
        </div>
      </div>

      <div class="section" ${configEditorScope === "global" ? "" : 'style="display:none"'}>
        <div class="section-title">Общий режим</div>
        <div class="form-row">
          <div class="form-group">
            <label>Режим ботов</label>
            <select id="cfg-mode">
              <option value="group" ${globalMode === "group" ? "selected" : ""}>Group</option>
              <option value="underground" ${globalMode === "underground" ? "selected" : ""}>Underground</option>
            </select>
          </div>
          <div class="form-group">
            <label>Hold mode</label>
            <select id="cfg-hold">
              <option value="true" ${cfg.application?.holdMode ? "selected" : ""}>Включён</option>
              <option value="false" ${!cfg.application?.holdMode ? "selected" : ""}>Выключен</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Ищем с</label>
            <input type="datetime-local" id="cfg-global-start" value="${globalWindow.start || ""}">
          </div>
          <div class="form-group">
            <label>Ищем до</label>
            <input type="datetime-local" id="cfg-global-end" value="${globalWindow.end || ""}">
          </div>
        </div>
        <div class="form-group">
          <label>Участники</label>
          <div class="tbl-wrap">
            <table id="cfg-parts-table" class="cfg-table" data-kind="participants">
              <thead>
                <tr>
                  <th>First name</th>
                  <th>Last name</th>
                  <th>Type</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>${renderParticipantRows(participants)}</tbody>
            </table>
          </div>
          <div class="action-row">
            <button class="btn btn-ghost cfg-add-row" type="button" data-kind="participant" data-target="cfg-parts-table">Добавить участника</button>
          </div>
        </div>
        <div class="form-group">
          <label>Tickets target</label>
          <div class="tbl-wrap">
            <table id="cfg-global-tickets-table" class="cfg-table" data-kind="tickets">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Quantity</th>
                  <th>Row</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>${renderTicketRows(globalTickets)}</tbody>
            </table>
          </div>
          <div class="action-row">
            <button class="btn btn-ghost cfg-add-row" type="button" data-kind="ticket" data-target="cfg-global-tickets-table">Добавить ticket</button>
          </div>
        </div>
      </div>

      <div class="section" ${configEditorScope === "single" ? "" : 'style="display:none"'}>
        <div class="section-title">Override одной ноды</div>
        <div class="config-hint">NODE_${String(selectedNodeId).padStart(2, "0")} получит свой override. Остальные ноды останутся на общем режиме.</div>
        <div class="form-row">
          <div class="form-group">
            <label>Режим ноды</label>
            <select id="cfg-single-mode">
              <option value="group" ${singleMode === "group" ? "selected" : ""}>Group</option>
              <option value="underground" ${singleMode === "underground" ? "selected" : ""}>Underground</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Ищем с</label>
            <input type="datetime-local" id="cfg-single-start" value="${singleWindow.start || ""}">
          </div>
          <div class="form-group">
            <label>Ищем до</label>
            <input type="datetime-local" id="cfg-single-end" value="${singleWindow.end || ""}">
          </div>
        </div>
        <div class="form-group">
          <label>Override tickets</label>
          <div class="tbl-wrap">
            <table id="cfg-single-tickets-table" class="cfg-table" data-kind="tickets">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Quantity</th>
                  <th>Row</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>${renderTicketRows(singleTickets)}</tbody>
            </table>
          </div>
          <div class="action-row">
            <button class="btn btn-ghost cfg-add-row" type="button" data-kind="ticket" data-target="cfg-single-tickets-table">Добавить ticket</button>
          </div>
        </div>
        <div class="action-row">
          <button class="btn btn-ghost" id="cfg-clear-single">Сбросить override ноды</button>
        </div>
      </div>

      ${renderConfigApplyResult(configApplyResult)}

      <div class="action-row">
        <button class="btn btn-primary" id="cfg-save">Сохранить черновик</button>
        <button class="btn btn-blue" id="cfg-apply">Применить без рестарта</button>
        <button class="btn btn-green" id="cfg-restart">Перезапустить ботов</button>
      </div>
    `;

    bindConfigTableActions();

    document.getElementById("cfg-scope")?.addEventListener("change", (e) => {
      configEditorScope = e.target.value;
      configApplyResult = null;
      renderConfigV2();
    });

    document.getElementById("cfg-node-select")?.addEventListener("change", (e) => {
      configEditorNodeId = parseInt(e.target.value, 10) || 12;
      configApplyResult = null;
      renderConfigV2();
    });

    document.getElementById("cfg-save")?.addEventListener("click", async () => {
      await saveConfigV2(cfg);
      configApplyResult = null;
      renderConfigV2();
    });

    document.getElementById("cfg-apply")?.addEventListener("click", async () => {
      const savedConfig = await saveConfigV2(cfg);
      const nodeIds = configEditorScope === "single" ? [configEditorNodeId] : undefined;
      toast("Применяем конфиг без рестарта...", "info");
      configApplyResult = await api("/config/apply", {
        method: "POST",
        body: { scope: configEditorScope, nodeIds }
      });
      if (savedConfig?.configMeta?.version) {
        configApplyResult.version = configApplyResult.version || savedConfig.configMeta.version;
      }
      const applied = (configApplyResult.results || []).filter((item) => item.status === "applied").length;
      const failed = (configApplyResult.results || []).filter((item) => item.status !== "applied").length;
      toast(`Apply завершён: ${applied} ok${failed ? `, ${failed} проблем` : ""}`, failed ? "error" : "success");
      renderConfigV2();
    });

    document.getElementById("cfg-clear-single")?.addEventListener("click", async () => {
      const next = JSON.parse(JSON.stringify(cfg));
      next.nodeOverrides = next.nodeOverrides || {};
      delete next.nodeOverrides[String(configEditorNodeId)];
      const response = await api("/config", { method: "PUT", body: next });
      configApplyResult = null;
      toast(`Override NODE_${configEditorNodeId} удалён (v${response.config?.configMeta?.version || "?"})`, "success");
      renderConfigV2();
    });

    document.getElementById("cfg-restart")?.addEventListener("click", async () => {
      await saveConfigV2(cfg);
      const nodeIds = configEditorScope === "single" ? [configEditorNodeId] : [];
      const label = nodeIds.length > 0 ? `NODE_${String(nodeIds[0]).padStart(2, "0")}` : "все ноды";
      if (!confirm(`Перезапустить ${label}?`)) return;
      try {
        toast(`Перезапуск: ${label}...`, "info");
        const result = await api("/config/restart", { method: "POST", body: { nodeIds } });
        const ok = result.results.filter((item) => item.ok).length;
        const fail = result.results.filter((item) => !item.ok).length;
        toast(`Перезапущено: ${ok}${fail > 0 ? `, ошибок: ${fail}` : ""}`, fail > 0 ? "error" : "success");
      } catch (e) {
        toast(e.message, "error");
      }
    });
  }).catch((e) => {
    if (revision !== renderRevision || currentPage !== "config") return;
    c.innerHTML = `<div class="section"><div class="section-title">Ошибка</div><div class="muted">${escapeHtml(e.message)}</div></div>`;
  });
}

async function saveConfigV2(base) {
  try {
    const cfg = JSON.parse(JSON.stringify(base || await api("/config")));
    cfg.application = cfg.application || {};
    cfg.targets = cfg.targets || [];
    cfg.nodeOverrides = cfg.nodeOverrides || {};

    if (configEditorScope === "global") {
      const mode = document.getElementById("cfg-mode")?.value || "group";
      const holdMode = document.getElementById("cfg-hold")?.value === "true";
      const start = document.getElementById("cfg-global-start")?.value || "";
      const end = document.getElementById("cfg-global-end")?.value || "";
      if (!start || !end) throw new Error("Укажи точное окно поиска");

      const activeTarget = getTargetByMode(cfg, mode);
      if (!activeTarget) throw new Error("Не найден target для выбранного режима");

      cfg.application.mode = mode;
      cfg.application.holdMode = holdMode;
      cleanupScheduleFields(activeTarget);
      activeTarget.target_datetime_start = start;
      activeTarget.target_datetime_end = end;
      activeTarget.tickets = readTicketsTable("cfg-global-tickets-table");
      cfg.participants = readParticipantsTable("cfg-parts-table");
    } else {
      const nodeId = String(configEditorNodeId);
      const mode = document.getElementById("cfg-single-mode")?.value || "group";
      const start = document.getElementById("cfg-single-start")?.value || "";
      const end = document.getElementById("cfg-single-end")?.value || "";
      if (!start || !end) throw new Error("Укажи точное окно поиска для выбранной ноды");

      const nextOverride = { ...(cfg.nodeOverrides[nodeId] || {}) };
      cleanupScheduleFields(nextOverride);
      nextOverride.mode = mode;
      nextOverride.target_datetime_start = start;
      nextOverride.target_datetime_end = end;
      nextOverride.tickets = readTicketsTable("cfg-single-tickets-table");
      cfg.nodeOverrides[nodeId] = pruneOverride(nextOverride);
    }

    const response = await api("/config", { method: "PUT", body: cfg });
    toast(`Сохранено (v${response.config?.configMeta?.version || "?"})`, "success");
    return response.config || cfg;
  } catch (e) {
    toast(e.message, "error");
    throw e;
  }
}

function fmtProxyHost(proxy) {
  if (!proxy) return "—";
  return `${proxy.host || "?"}:${proxy.port || "?"}`;
}

async function applyProxyDistribution(restartChanged) {
  const actionLabel = restartChanged
    ? "применить раскладку и перезапустить изменённые ноды"
    : "применить раскладку";
  if (!confirm(`Подтвердить: ${actionLabel}?`)) return;
  try {
    toast(restartChanged ? "Применяем прокси и перезапускаем ноды..." : "Применяем новую раскладку прокси...", "info");
    const result = await api("/proxies/apply", { method: "POST", body: { restartChanged } });
    const changed = result.changedNodeIds?.length || 0;
    if (restartChanged) {
      const ok = (result.restartResults || []).filter((item) => item.ok).length;
      const fail = (result.restartResults || []).filter((item) => !item.ok).length;
      toast(`Прокси обновлены. Изменено нод: ${changed}. Рестарт: ${ok} ok${fail ? `, ${fail} ошибок` : ""}`, fail ? "error" : "success");
    } else {
      toast(`Прокси обновлены. Изменено нод: ${changed}`, "success");
    }
    renderProxies();
  } catch (e) {
    toast(e.message, "error");
  }
}

function renderProxies() {
  const revision = renderRevision;
  const c = document.getElementById("page-content");
  c.innerHTML = '<div class="section"><div class="section-title">Загрузка...</div></div>';

  Promise.allSettled([api("/proxies"), api("/proxies/distribution-preview")])
    .then(([currentResult, previewResult]) => {
      if (revision !== renderRevision || currentPage !== "proxies") return;
      if (currentResult.status !== "fulfilled") throw currentResult.reason;

      const current = currentResult.value;
      const preview = previewResult.status === "fulfilled" ? previewResult.value : null;
      const previewError = previewResult.status === "rejected" ? previewResult.reason.message : null;

      const currentRows = Object.values(current)
        .sort((a, b) => a.nodeId - b.nodeId)
        .map((p) => {
          const bans = Object.values(p.bans || {}).filter((ts) => ts > Date.now()).length;
          const mode = p.mode || "group";
          return `
            <tr>
              <td><b>NODE_${String(p.nodeId).padStart(2, "0")}</b> <span class="node-tag ${mode}">${mode === "underground" ? "UND" : "GRP"}</span></td>
              <td>${escapeHtml(p.ip)}</td>
              <td style="font-family:var(--mono)">#${p.currentProxy} ${escapeHtml(fmtProxyHost(p.activeProxy))}</td>
              <td>${p.currentCount}</td>
              <td>${p.nextCount}</td>
              <td>${p.changed ? '<span class="badge badge-checkout">changed</span>' : '<span class="badge badge-running">same</span>'}</td>
              <td>${bans > 0 ? `<span class="badge badge-banned">${bans}</span>` : '<span class="badge badge-running">OK</span>'}</td>
              <td><span class="badge badge-${p.status}">${escapeHtml(p.status)}</span></td>
            </tr>
          `;
        }).join("");

      const previewRows = preview ? preview.nodes.map((node) => `
        <tr>
          <td><b>NODE_${String(node.nodeId).padStart(2, "0")}</b></td>
          <td>${node.oldCount}</td>
          <td>${node.newCount}</td>
          <td>${node.changed ? '<span class="badge badge-checkout">yes</span>' : '<span class="badge badge-running">no</span>'}</td>
        </tr>
      `).join("") : "";

      const invalidBlock = preview && (preview.invalidCount > 0 || (preview.validationErrors || []).length > 0)
        ? `
          <div class="section">
            <div class="section-title">Ошибки импорта <span>${preview.invalidCount}</span></div>
            ${(preview.validationErrors || []).length > 0 ? `
              <div class="proxy-error-list">
                ${preview.validationErrors.map((item) => `<div class="proxy-error-row">${escapeHtml(item)}</div>`).join("")}
              </div>
            ` : ""}
            ${(preview.invalidLines || []).length > 0 ? `
              <div class="proxy-error-list">
                ${preview.invalidLines.map((item) => `
                  <div class="proxy-error-row">#${item.lineNumber}: ${escapeHtml(item.reason)}<span>${escapeHtml(item.line)}</span></div>
                `).join("")}
              </div>
            ` : ""}
          </div>
        `
        : "";

      const previewBlock = preview
        ? `
          ${renderHero({
            eyebrow: "Прокси-контур",
            title: "Preview и раскладка по нодам",
            copy: "Экран показывает текущее распределение, будущую раскладку и diff по всем нодам.",
            chips: [
              `${preview.totalInput} строк во входе`,
              `${preview.validUnique} валидных`,
              `${preview.changedNodeIds.length} нод изменится`
            ],
            sideCards: [
              { label: "Min / Max", value: `${preview.distributionSummary.minPerNode} / ${preview.distributionSummary.maxPerNode}`, sub: "размер пула на ноду", className: "yellow" },
              { label: "Применение", value: preview.canApply ? "READY" : "BLOCKED", sub: preview.sourcePath, className: preview.canApply ? "green" : "red" }
            ]
          })}
          <div class="stats-row">
            ${statCard("Во входном файле", preview.totalInput, "строк с прокси", "blue")}
            ${statCard("Уникальных валидных", preview.validUnique, "после дедупликации", "green")}
            ${statCard("Min / Max на ноду", `${preview.distributionSummary.minPerNode} / ${preview.distributionSummary.maxPerNode}`, "равномерная раскладка", "yellow")}
            ${statCard("Изменится нод", preview.changedNodeIds.length, `из ${preview.distributionSummary.nodeCount}`, "purple")}
          </div>
          <div class="section">
            <div class="section-title">Import / Preview <span>${escapeHtml(preview.sourcePath)}</span></div>
            <div class="proxy-toolbar">
              <button class="btn btn-ghost" id="proxy-refresh">Обновить preview</button>
              <button class="btn btn-blue" id="proxy-apply" ${preview.canApply ? "" : "disabled"}>Apply distribution</button>
              <button class="btn btn-green" id="proxy-apply-restart" ${preview.canApply ? "" : "disabled"}>Apply + restart changed</button>
            </div>
            <div class="tbl-wrap">
              <table>
                <thead><tr><th>Нода</th><th>Текущее</th><th>Новое</th><th>Изменится</th></tr></thead>
                <tbody>${previewRows}</tbody>
              </table>
            </div>
          </div>
        `
        : `
          ${renderHero({
            eyebrow: "Прокси-контур",
            title: "Preview сейчас недоступен",
            copy: "Текущее распределение можно посмотреть ниже, но для preview возникла ошибка.",
            chips: ["preview не собран"],
            sideCards: [{ label: "Статус", value: "ERROR", sub: previewError || "неизвестная ошибка", className: "red" }]
          })}
          <div class="section">
            <div class="section-title">Import / Preview</div>
            <div class="muted">${escapeHtml(previewError || "Не удалось собрать preview.")}</div>
            <div class="proxy-toolbar" style="margin-top:12px">
              <button class="btn btn-ghost" id="proxy-refresh">Повторить preview</button>
            </div>
          </div>
        `;

      c.innerHTML = `
        ${previewBlock}
        ${invalidBlock}
        <div class="section">
          <div class="section-title">Текущая раскладка по нодам</div>
          <div class="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Нода</th>
                  <th>IP</th>
                  <th>Активный прокси</th>
                  <th>Сейчас</th>
                  <th>После apply</th>
                  <th>Diff</th>
                  <th>Баны</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>${currentRows}</tbody>
            </table>
          </div>
        </div>
      `;

      document.getElementById("proxy-refresh")?.addEventListener("click", () => renderProxies());
      document.getElementById("proxy-apply")?.addEventListener("click", () => applyProxyDistribution(false));
      document.getElementById("proxy-apply-restart")?.addEventListener("click", () => applyProxyDistribution(true));
    })
    .catch((e) => {
      if (revision !== renderRevision || currentPage !== "proxies") return;
      c.innerHTML = `<div class="section"><div class="section-title">Ошибка</div><div class="muted">${escapeHtml(e.message)}</div></div>`;
    });
}

function renderPayment() {
  requestFreshNodes("payment");
  const c = document.getElementById("page-content");
  const cartNodes = nodes.filter(hasActiveCart);
  if (!cartNodes.length) {
    paymentSelectedNodeId = null;
    activeVncSession = null;
    c.innerHTML = renderHero({
      eyebrow: "Оплата",
      title: "Активных корзин сейчас нет",
      copy: "Когда хотя бы одна нода удержит билеты, здесь появится управление оплатой и доступ к VNC.",
      chips: ["0 активных корзин"],
      sideCards: [
        { label: "Ноды в hold", value: nodes.filter((n) => n.bot_status === "hold").length, sub: "ещё без перехода к оплате", className: "blue" },
        { label: "Checkout", value: nodes.filter((n) => n.bot_status === "checkout").length, sub: "готовы к оплате", className: "yellow" }
      ]
    });
    return;
  }

  const selectedNodeId =
    cartNodes.some((node) => node.id === paymentSelectedNodeId) ? paymentSelectedNodeId :
    cartNodes.some((node) => node.id === activeVncSession?.nodeId) ? activeVncSession.nodeId :
    cartNodes[0].id;

  paymentSelectedNodeId = selectedNodeId;

  const activeVnc = activeVncSession && activeVncSession.nodeId === selectedNodeId
    ? activeVncSession
    : null;

  const options = cartNodes.map((n) => `
    <option value="${n.id}" ${n.id === selectedNodeId ? "selected" : ""}>[NODE_${String(n.id).padStart(2, "0")}] ${escapeHtml(fmtSlotFull(n.current_slot))} — ${escapeHtml(trunc(n.cart_items || getCartState(n), 44))}</option>
  `).join("");

  c.innerHTML = `
    ${renderHero({
      eyebrow: "Оплата",
      title: "Управление живыми корзинами",
      copy: "Здесь отправляется /pay, открывается noVNC и формируется RDP для ноды, которая уже держит билеты.",
      chips: [`${cartNodes.length} активных корзин`],
      sideCards: [
        { label: "Checkout", value: cartNodes.filter((n) => n.bot_status === "checkout").length, sub: "ноды в checkout", className: "yellow" },
        { label: "Hold", value: cartNodes.filter((n) => n.bot_status === "hold").length, sub: "ноды удерживают слот", className: "blue" }
      ]
    })}
    <div class="section">
      <div class="section-title">Терминал оплаты</div>
      <div class="form-row">
        <div class="form-group">
          <label>Узел с билетами</label>
          <select id="pay-node">${options}</select>
        </div>
      </div>
      <div class="action-row">
        <button class="btn btn-primary" id="pay-btn">Отправить /pay</button>
        <button class="btn btn-green" id="vnc-btn">Открыть noVNC</button>
        <button class="btn btn-red" id="vnc-stop-btn" style="display:${activeVnc ? "inline-flex" : "none"}">Закрыть VNC</button>
        <button class="btn btn-ghost" id="rdp-btn">Скачать RDP</button>
      </div>
      <div id="pay-status" class="muted" style="margin-top:10px">${activeVnc ? `VNC подключён на NODE_${selectedNodeId}` : ""}</div>
    </div>
    <div id="vnc-panel" class="section" style="display:${activeVnc ? "block" : "none"}">
      <div class="section-title">VNC сессия <span id="vnc-label">${activeVnc ? `NODE_${String(selectedNodeId).padStart(2, "0")} (ws:${activeVnc.wsPort})` : "VNC"}</span></div>
      <div class="action-row" style="margin-bottom:12px">
        <a id="vnc-newwin" class="btn btn-ghost btn-sm" href="${activeVnc ? activeVnc.url : "#"}" target="_blank">Открыть в новой вкладке</a>
      </div>
      <iframe id="vnc-frame" style="height:72vh;background:#000;border-radius:16px" src="${activeVnc ? activeVnc.url : "about:blank"}"></iframe>
    </div>
    <div class="section">
      <div class="section-title">Активные корзины</div>
      <div class="tbl-wrap">
        <table>
          <thead>
            <tr><th>Нода</th><th>IP</th><th>Слот</th><th>Билеты</th><th>Статус</th><th>Цикл</th></tr>
          </thead>
          <tbody>
            ${cartNodes.map((n) => `
              <tr>
                <td><b>NODE_${String(n.id).padStart(2, "0")}</b> <span class="node-tag ${isUnder(n) ? "underground" : "group"}">${isUnder(n) ? "UND" : "GRP"}</span></td>
                <td>${escapeHtml(n.ip)}</td>
                <td style="font-family:var(--mono)">${escapeHtml(fmtSlotFull(n.current_slot))}</td>
                <td>${escapeHtml(n.cart_items || "cart tracked, details pending")}</td>
                <td><span class="badge badge-${n.bot_status || "unknown"}">${escapeHtml(prettyBot(n.bot_status))}</span> <span class="badge badge-${getCartState(n) === "checkout" ? "online" : "hold"}">${escapeHtml(getCartState(n))}</span></td>
                <td>#${n.hold_cycle || 0}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById("pay-node")?.addEventListener("change", (event) => {
    paymentSelectedNodeId = parseInt(event.target.value, 10);
    if (!activeVncSession || activeVncSession.nodeId !== paymentSelectedNodeId) {
      renderPayment();
    }
  });

  document.getElementById("pay-btn")?.addEventListener("click", async () => {
    const id = document.getElementById("pay-node").value;
    const status = document.getElementById("pay-status");
    try {
      status.textContent = `Отправляем /pay на NODE_${id}...`;
      await api(`/nodes/${id}/pay`, { method: "POST" });
      status.textContent = `Команда /pay отправлена на NODE_${id}`;
      toast(`/pay -> NODE_${id}`, "success");
    } catch (e) {
      status.textContent = e.message;
      toast(e.message, "error");
    }
  });

  document.getElementById("vnc-btn")?.addEventListener("click", async () => {
    const id = parseInt(document.getElementById("pay-node").value, 10);
    const status = document.getElementById("pay-status");
    try {
      status.textContent = `Запускаем VNC на NODE_${id}...`;
      const result = await api(`/vnc/${id}/start`, { method: "POST" });
      const url = `/novnc/vnc.html?host=${location.hostname}&port=${result.wsPort}&autoconnect=true&resize=scale&quality=6&encrypt=1`;
      paymentSelectedNodeId = id;
      activeVncSession = { nodeId: id, wsPort: result.wsPort, url };
      document.getElementById("vnc-frame").src = url;
      document.getElementById("vnc-label").textContent = `NODE_${String(id).padStart(2, "0")} (ws:${result.wsPort})`;
      document.getElementById("vnc-newwin").href = url;
      document.getElementById("vnc-panel").style.display = "block";
      document.getElementById("vnc-stop-btn").style.display = "inline-flex";
      status.textContent = `VNC подключён на NODE_${id}`;
      toast(`VNC -> NODE_${id}`, "success");
    } catch (e) {
      status.textContent = e.message;
      toast(e.message, "error");
    }
  });

  document.getElementById("vnc-stop-btn")?.addEventListener("click", async () => {
    const id = activeVncSession?.nodeId || parseInt(document.getElementById("pay-node").value, 10);
    try {
      await api(`/vnc/${id}`, { method: "DELETE" });
      activeVncSession = null;
      document.getElementById("vnc-frame").src = "about:blank";
      document.getElementById("vnc-panel").style.display = "none";
      document.getElementById("vnc-stop-btn").style.display = "none";
      toast("VNC закрыт", "info");
    } catch (e) {
      toast(e.message, "error");
    }
  });

  document.getElementById("rdp-btn")?.addEventListener("click", () => {
    const id = parseInt(document.getElementById("pay-node").value, 10);
    const node = nodes.find((item) => item.id === id);
    if (!node) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([`full address:s:${node.ip}:3389\nusername:s:root\nauthentication level:i:0\nprompt for credentials:i:0\n`], { type: "application/rdp" }));
    a.download = `Node_${String(id).padStart(2, "0")}_${node.ip}.rdp`;
    a.click();
    toast(`RDP для NODE_${id} скачан`, "info");
  });
}

function renderEvents() {
  const revision = renderRevision;
  const c = document.getElementById("page-content");
  c.innerHTML = '<div class="section"><div class="section-title">Загрузка...</div></div>';
  api("/events?limit=200")
    .then((events) => {
      if (revision !== renderRevision) return;
      if (!events.length) {
        c.innerHTML = '<div class="section"><div class="section-title">События</div><div class="muted">Нет событий</div></div>';
        return;
      }
      c.innerHTML = `
        <div class="section">
          <div class="section-title">События <span>${events.length}</span></div>
          <div class="status-list">
            ${events.map((ev) => `
              <div class="status-list-row">
                <div>
                  <div class="inline-row-name">${new Date(ev.created_at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div>
                  <div class="muted">${escapeHtml(ev.message || "—")}</div>
                </div>
                <div><span class="badge badge-running">${escapeHtml(ev.type)}</span></div>
              </div>
            `).join("")}
          </div>
        </div>
      `;
    })
    .catch((e) => {
      if (revision !== renderRevision) return;
      c.innerHTML = `<div class="section"><div class="section-title">Ошибка</div><div class="muted">${escapeHtml(e.message)}</div></div>`;
    });
}

async function startNode(id) {
  try {
    toast(`Запуск NODE_${id}...`, "info");
    await api(`/nodes/${id}/start`, { method: "POST" });
    toast(`NODE_${id} запущен`, "success");
  } catch (e) {
    toast(e.message, "error");
  }
}

async function stopNode(id) {
  try {
    await api(`/nodes/${id}/stop`, { method: "POST" });
    toast(`NODE_${id} остановлен`, "success");
  } catch (e) {
    toast(e.message, "error");
  }
}

async function deployAll() {
  try {
    toast("Деплой...", "info");
    await api("/deploy", { method: "POST", body: {} });
    toast("Деплой завершён", "success");
  } catch (e) {
    toast(e.message, "error");
  }
}

async function deploySidecarAll() {
  try {
    toast("Активация sidecar...", "info");
    await api("/deploy-sidecar", { method: "POST" });
    toast("Sidecar активирован", "success");
  } catch (e) {
    toast(e.message, "error");
  }
}

document.getElementById("btn-start-all")?.addEventListener("click", async () => {
  if (!confirm("Запустить всех?")) return;
  try {
    toast("Запуск...", "info");
    await api("/nodes/start-all", { method: "POST" });
    toast("Все запущены", "success");
  } catch (e) {
    toast(e.message, "error");
  }
});

document.getElementById("btn-stop-all")?.addEventListener("click", async () => {
  if (!confirm("Остановить всех?")) return;
  try {
    await api("/nodes/stop-all", { method: "POST" });
    toast("Все остановлены", "success");
  } catch (e) {
    toast(e.message, "error");
  }
});

document.getElementById("btn-deploy")?.addEventListener("click", deployAll);
document.getElementById("btn-deploy-sidecar")?.addEventListener("click", deploySidecarAll);
document.getElementById("sidebar-toggle")?.addEventListener("click", toggleSidebar);
window.addEventListener("resize", applySidebarState);

checkAuth();
