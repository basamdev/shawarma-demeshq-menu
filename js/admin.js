// Admin.js — Ali Coffee Admin Panel

const orderItems = [];
let activeItemModal = null;
let cashierUnsubscribe = null;
let cashierActiveFilter = 'all';
let categoriesUnsubscribe = null;
let itemsUnsubscribe = null;
var dashboardUnsubscribes = [];
var _itemsSnapDocs = [];
let itemsActiveCategory = 'all';

/* ============ OFFLINE CACHE (localStorage backup for admin) ============ */

function readCachedMenuItemsFlat() {
    try {
        return JSON.parse(localStorage.getItem('cachedMenuItems') || '[]');
    } catch (e) {
        return [];
    }
}

function writeCachedMenuItemsFlat(items) {
    try {
        localStorage.setItem('cachedMenuItems', JSON.stringify(items));
        syncCashierCacheFromMenuFlat(items);
    } catch (e) {
        console.warn('Could not write menu cache:', e);
    }
}

function syncCashierCacheFromMenuFlat(items) {
    var cashier = [];
    (items || []).forEach(function (it) {
        if (!it || !it.id || it.category === 'Water' || it.available === false) return;
        var v = Object.assign({}, it);
        delete v.id;
        cashier.push({ id: it.id, v: v });
    });
    try {
        localStorage.setItem('cachedCashierItems', JSON.stringify(cashier));
    } catch (e) {}
}

function serializableFirestoreData(data) {
    var o = Object.assign({}, data || {});
    delete o.updated_at;
    delete o.created_at;
    return o;
}

function fakeFirestoreDoc(id, data) {
    var payload = Object.assign({}, data);
    return {
        id: id,
        exists: true,
        data: function () { return payload; }
    };
}

function getItemDocsFromLocalCache() {
    return readCachedMenuItemsFlat()
        .filter(function (it) { return it && it.id && it.category !== 'Water'; })
        .map(function (it) {
            var data = Object.assign({}, it);
            var id = data.id;
            delete data.id;
            return fakeFirestoreDoc(id, data);
        });
}

function getMenuItemFromLocalCache(itemId) {
    var items = readCachedMenuItemsFlat();
    for (var i = 0; i < items.length; i++) {
        if (items[i].id === itemId) return items[i];
    }
    return null;
}

function upsertCachedMenuItem(id, data) {
    if (!id) return;
    var flat = serializableFirestoreData(data);
    var items = readCachedMenuItemsFlat();
    var found = false;
    items = items.map(function (it) {
        if (it.id === id) {
            found = true;
            return Object.assign({ id: id }, flat);
        }
        return it;
    });
    if (!found) items.push(Object.assign({ id: id }, flat));
    writeCachedMenuItemsFlat(items);
    _itemsSnapDocs = getItemDocsFromLocalCache();
}

function removeCachedMenuItem(id) {
    if (!id) return;
    var items = readCachedMenuItemsFlat().filter(function (it) { return it.id !== id; });
    writeCachedMenuItemsFlat(items);
    _itemsSnapDocs = getItemDocsFromLocalCache();
}

/* ============ SALES CACHE (offline dashboard + cashier) ============ */

function readCachedSales() {
    try {
        return JSON.parse(localStorage.getItem('cachedSales') || '[]');
    } catch (e) {
        return [];
    }
}

function writeCachedSales(items) {
    try {
        localStorage.setItem('cachedSales', JSON.stringify(items));
    } catch (e) {}
}

function saleTimestampToMs(item) {
    if (!item) return 0;
    if (item.timestampSeconds != null) return item.timestampSeconds * 1000;
    var ts = item.timestamp;
    if (!ts) return 0;
    if (typeof ts.toDate === 'function') return ts.toDate().getTime();
    if (ts.seconds != null) return ts.seconds * 1000;
    if (ts._seconds != null) return ts._seconds * 1000;
    var parsed = new Date(ts);
    return isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function saleEntryFromDoc(doc) {
    var s = doc.data();
    var ts = s.timestamp;
    var timestampSeconds = null;
    if (ts && ts.seconds != null) timestampSeconds = ts.seconds;
    else if (ts && ts._seconds != null) timestampSeconds = ts._seconds;
    else if (ts && typeof ts.toDate === 'function') timestampSeconds = Math.floor(ts.toDate().getTime() / 1000);
    return {
        id: doc.id,
        items: s.items || [],
        total: s.total || 0,
        timestampSeconds: timestampSeconds,
        cashier: s.cashier
    };
}

function upsertCachedSale(entry) {
    var items = readCachedSales();
    var idx = -1;
    for (var i = 0; i < items.length; i++) {
        if (items[i].id === entry.id) { idx = i; break; }
    }
    if (idx >= 0) items[idx] = entry;
    else items.push(entry);
    writeCachedSales(items);
}

function removeCachedSale(id) {
    writeCachedSales(readCachedSales().filter(function (s) { return s.id !== id; }));
}

function mergeSalesSnapIntoCache(snap) {
    if (!snap || snap.empty) return;
    var all = readCachedSales();
    snap.forEach(function (doc) {
        var entry = saleEntryFromDoc(doc);
        var found = false;
        for (var i = 0; i < all.length; i++) {
            if (all[i].id === entry.id) { all[i] = entry; found = true; break; }
        }
        if (!found) all.push(entry);
    });
    writeCachedSales(all);
}

function sumSalesInRange(start, end) {
    var total = 0;
    var count = 0;
    var startMs = start.getTime();
    var endMs = end.getTime();
    readCachedSales().forEach(function (s) {
        var ms = saleTimestampToMs(s);
        if (ms >= startMs && ms < endMs) {
            total += s.total || 0;
            count++;
        }
    });
    return { total: total, count: count };
}

function sumExpensesInRange(start, end) {
    var total = 0;
    var startMs = start.getTime();
    var endMs = end.getTime();
    readCachedExpenses().forEach(function (e) {
        var ms = expenseTimestampToMs(e);
        if (ms >= startMs && ms < endMs) total += e.price || 0;
    });
    return total;
}

function hydrateItemsUiFromCache() {
    var docs = getItemDocsFromLocalCache();
    if (!docs.length) return false;
    _itemsSnapDocs = docs;
    refreshCategoryFilterOptions();
    refreshItemCategoryDropdown();
    var searchEl = document.getElementById('itemSearch');
    var searchTerm = searchEl ? searchEl.value : '';
    renderItemsList(filterItemDocs(_itemsSnapDocs, searchTerm, itemsActiveCategory));
    return true;
}

function warmAdminOfflineCache(done) {
    if (!window.db) {
        if (typeof done === 'function') done();
        return;
    }
    var tasks = [];
    tasks.push(db.collection('menuItems').get().then(function (snap) {
        var menu = [];
        snap.forEach(function (d) {
            menu.push(Object.assign({ id: d.id }, d.data()));
        });
        writeCachedMenuItemsFlat(menu);
    }).catch(function () {}));
    tasks.push(db.collection('categories').get().then(function (snap) {
        var categories = [];
        snap.forEach(function (d) {
            categories.push({ id: d.id, data: d.data() });
        });
        localStorage.setItem('cachedCategories', JSON.stringify(categories));
    }).catch(function () {}));
    tasks.push(db.collection('expenses').get().then(function (snap) {
        var expenses = [];
        snap.forEach(function (d) {
            expenses.push(expenseEntryFromDoc(d));
        });
        writeCachedExpenses(expenses);
    }).catch(function () {}));
    tasks.push(db.collection('sales').get().then(function (snap) {
        var sales = [];
        snap.forEach(function (d) {
            sales.push(saleEntryFromDoc(d));
        });
        writeCachedSales(sales);
    }).catch(function () {}));
    Promise.all(tasks).then(function () {
        try { localStorage.setItem('adminCacheWarmedAt', String(Date.now())); } catch (e) {}
        if (typeof done === 'function') done();
    });
}

var ADMIN_VERSION = 'v75';

function isAdminAuthenticated() {
    return !!(window.auth && auth.currentUser);
}

var _adminAuthInitialized = false;
window.adminAuthReady = new Promise(function (resolve) {
    if (!window.auth) {
        resolve(null);
        return;
    }
    auth.onAuthStateChanged(function (user) {
        if (!_adminAuthInitialized) {
            _adminAuthInitialized = true;
            resolve(user);
        }
        if (user) {
            warmAdminOfflineCache();
            refreshAdminCurrentSection();
        } else if (navigator.onLine) {
            window.location.href = 'login.html';
        }
    });
});

function whenAdminReady(fn) {
    var dbP = window.dbReady || Promise.resolve(window.db);
    return Promise.all([dbP, window.adminAuthReady]).then(function (results) {
        if (typeof fn === 'function') fn(results[1]);
    });
}

/** Plain Firestore read for sales/expenses — only after login (rules require auth). */
function adminProtectedGet(queryOrRef) {
    if (!isAdminAuthenticated()) {
        return Promise.reject(new Error('Not signed in'));
    }
    return queryOrRef.get();
}

function adminGetWithTimeout(queryOrRef, ms) {
    ms = ms || (navigator.onLine ? 25000 : 10000);
    var cacheSnap = null;

    function raceServer() {
        return Promise.race([
            queryOrRef.get(),
            new Promise(function (_, reject) {
                setTimeout(function () { reject(new Error('Connection timeout')); }, ms);
            })
        ]);
    }

    return queryOrRef.get({ source: 'cache' }).then(function (snap) {
        cacheSnap = snap;
        if (snap && !snap.empty) {
            raceServer().catch(function () {});
            return snap;
        }
        return raceServer();
    }).catch(function (err) {
        if (cacheSnap) return cacheSnap;
        return queryOrRef.get({ source: 'cache' }).then(function (snap) {
            if (snap) return snap;
            throw err;
        });
    });
}

function refreshAdminCurrentSection() {
    var activeBtn = document.querySelector('.admin-nav-btn.active');
    if (!activeBtn) return;
    var section = activeBtn.getAttribute('data-section');
    if (section === 'dashboard' && document.getElementById('todaySales')) {
        var sel = document.getElementById('dashboardMonthSelect');
        var month = sel ? parseInt(sel.value, 10) : new Date().getMonth();
        paintDashboardFromCache(month);
        loadDashboardStats(month);
        loadRecentSales();
    } else if (section === 'expenses' && document.getElementById('expensesList')) {
        var expSel = document.getElementById('expensesMonthSelect');
        var expMonth = expSel ? parseInt(expSel.value, 10) : new Date().getMonth();
        paintExpensesStatsFromCache(expMonth);
        loadExpensesStats(expMonth);
        loadExpensesList(expMonth);
    } else if (section === 'items' && document.getElementById('itemsList')) {
        hydrateItemsUiFromCache();
        loadItemsList();
    }
}

function whenAdminDbReady(fn) {
    return whenAdminReady(fn);
}

function clearAdminLoadingEl(elementId, html) {
    var el = document.getElementById(elementId);
    if (!el) return;
    if (el.querySelector('.loading')) {
        el.innerHTML = html || '';
    }
}

function adminSectionStillLoading(elementId) {
    var el = document.getElementById(elementId);
    return !!(el && el.querySelector('.loading'));
}

function stopCategoriesListener() {
    if (categoriesUnsubscribe) {
        try { categoriesUnsubscribe(); } catch (e) {}
        categoriesUnsubscribe = null;
    }
}

window.initAdminPanel = initAdminPanel;
window.loadAdminSection = loadAdminSection;
window.loadDashboard = loadDashboard;
window.editItem = editItem;
window.deleteItem = deleteItem;
window.saveItem = saveItem;
window.loadCashier = loadCashier;
window.loadExpenses = loadExpenses;
window.loadSettings = loadSettings;
window.handleLogout = handleLogout;
window.editCategory = editCategory;
window.deleteCategory = deleteCategory;
window.saveCategory = saveCategory;
window.printReceipt = printReceipt;
window.setupAdminOfflineDetection = setupAdminOfflineDetection;
window.populateTestData = populateTestData;

document.addEventListener('DOMContentLoaded', function () {
    setupAdminOfflineDetection();

    const LOGO_HINTS = [
        'assets/ali-cafe-logo-circular.png',
        'images/ali-cafe-logo-circular.png',
    ];
    let logoTry = 0;
    window.fallbackLogo = function (img) {
        if (!img || !(img instanceof HTMLImageElement)) return;
        img.addEventListener('error', function () {
            img.style.display = 'none';
            var fallback = document.createElement('div');
            fallback.className = 'logo-fallback-initials';
            fallback.textContent = 'AC';
            fallback.style.cssText = 'width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:serif;font-size:1.25rem;font-weight:700;color:#D4AF37;background:#1a1a1a;flex-shrink:0;';
            if (img.parentNode) img.parentNode.insertBefore(fallback, img);
        });
    };
    document.querySelectorAll('img.sidebar-brand-icon, img.logo').forEach(window.fallbackLogo);

    applyAdminAccent(localStorage.getItem('adminAccent') || 'gold');
    initAdminPanel();
    wireAdminLangButtons();
    initSidebar();

    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState !== 'visible') return;
        var activeBtn = document.querySelector('.admin-nav-btn.active');
        if (!activeBtn) return;
        var section = activeBtn.getAttribute('data-section');
        if (section === 'dashboard' && document.getElementById('todaySales')) {
            var sel = document.getElementById('dashboardMonthSelect');
            var month = sel ? parseInt(sel.value, 10) : new Date().getMonth();
            loadDashboardStats(month);
            loadRecentSales();
        } else if (section === 'items' && document.getElementById('itemsList')) {
            loadItemsList();
        } else if (section === 'expenses' && document.getElementById('expensesList')) {
            var expSel = document.getElementById('expensesMonthSelect');
            var expMonth = expSel ? parseInt(expSel.value, 10) : new Date().getMonth();
            loadExpensesStats(expMonth);
            loadExpensesList(expMonth);
        }
    });

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(function () {});
    }
});

function wireAdminLangButtons() {
    var lang = localStorage.getItem('selectedLang') || 'ku';
    document.documentElement.dir = (lang === 'ar' || lang === 'ku') ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
    document.querySelectorAll('.admin-lang-btn').forEach(function (btn) {
        btn.classList.toggle('active', btn.getAttribute('data-lang') === lang);
        btn.addEventListener('click', function () {
            var l = this.getAttribute('data-lang');
            localStorage.setItem('selectedLang', l);
            document.querySelectorAll('.admin-lang-btn').forEach(function (b) { b.classList.remove('active'); });
            this.classList.add('active');
            document.documentElement.dir = (l === 'ar' || l === 'ku') ? 'rtl' : 'ltr';
            document.documentElement.lang = l;
            if (window.applyLanguageUI) applyLanguageUI(l);
        });
    });
}

function initSidebar() {
    var sidebar = document.getElementById('adminSidebar');
    var hamburger = document.getElementById('sidebarHamburger');
    var closeBtn = document.getElementById('sidebarClose');
    var overlay = document.getElementById('sidebarOverlay');

    if (!sidebar) return;

    function openSidebar() {
        sidebar.classList.add('open');
        if (overlay) overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeSidebar() {
        sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('active');
        document.body.style.overflow = '';
    }

    if (hamburger) {
        hamburger.addEventListener('click', function (e) {
            e.stopPropagation();
            openSidebar();
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', function () {
            closeSidebar();
        });
    }

    if (overlay) {
        overlay.addEventListener('click', function () {
            closeSidebar();
        });
    }

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && sidebar.classList.contains('open')) {
            closeSidebar();
        }
    });
}

function initAdminPanel() {
    var navButtons = document.querySelectorAll('.admin-nav-btn');
    navButtons.forEach(function (btn) {
        btn.addEventListener('click', function () {
            navButtons.forEach(function (b) { b.classList.remove('active'); });
            this.classList.add('active');
            var section = this.getAttribute('data-section');
            loadAdminSection(section);
            var headerTitle = document.querySelector('.admin-header h1');
            if (headerTitle) {
                var label = this.querySelector('span:last-child');
                headerTitle.textContent = label ? label.textContent.trim() : this.textContent.trim();
            }
            var sidebar = document.getElementById('adminSidebar');
            var overlay = document.getElementById('sidebarOverlay');
            if (sidebar && sidebar.classList.contains('open')) {
                sidebar.classList.remove('open');
                if (overlay) overlay.classList.remove('active');
                document.body.style.overflow = '';
            }
        });
    });

    var defaultBtn = document.querySelector('.admin-nav-btn.active');
    if (defaultBtn) {
        whenAdminReady(function () {
            loadAdminSection(defaultBtn.getAttribute('data-section'));
        });
    }
}

function loadAdminSection(section) {
    if (section !== 'cashier') {
        stopCashierListener();
    }
    if (section !== 'categories') {
        stopCategoriesListener();
    }
    if (section !== 'dashboard') {
        stopDashboardListeners();
    }
    if (section !== 'items') {
        stopItemsListener();
    }
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var adminContent = document.getElementById('adminContent');
    if (!adminContent) return;
    adminContent.innerHTML = '<div class="loading">' + S.loading + '</div>';

    try {
        if (section === 'dashboard') { loadDashboard(); }
        else if (section === 'items') { loadManageItems(); }
        else if (section === 'categories') { loadManageCategories(); }
        else if (section === 'cashier') { loadCashier(); }
        else if (section === 'expenses') { loadExpenses(); }
        else if (section === 'settings') { loadSettings(); }
        else if (section === 'logout') { handleLogout(); }
        else { adminContent.innerHTML = '<p>' + S.sectionNotFound + '</p>'; }
    } catch (error) {
        console.error(S.errorLoadingSection + section + ':', error);
        adminContent.innerHTML = '<p style="color:#C62828;padding:20px;">' + S.errorPrefix + error.message + '</p>';
    }
}

function toDisplayTime(ts) {
    if (!ts) return '\u2014';
    if (typeof ts.toDate === 'function') return ts.toDate().toLocaleTimeString();
    if (ts.seconds != null) return new Date(ts.seconds * 1000).toLocaleTimeString();
    if (ts._seconds != null) return new Date(ts._seconds * 1000).toLocaleTimeString();
    return String(ts);
}

/* ============ DASHBOARD ============ */

function getMonthName(monthIndex, strings) {
    var keys = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    return (monthIndex + 1) + ' — ' + (strings[keys[monthIndex]] || (monthIndex + 1));
}

function loadDashboard() {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var adminContent = document.getElementById('adminContent');
    var now = new Date();
    var currentMonth = now.getMonth();
    var monthsHtml = '';
    var mNames = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    for (var m = 0; m < 12; m++) {
        monthsHtml += '<option value="' + m + '"' + (m === currentMonth ? ' selected' : '') + '>' + (m + 1) + ' — ' + S[mNames[m]] + ' ' + now.getFullYear() + '</option>';
    }
    adminContent.innerHTML =
        '<div class="month-selector">' +
            '<label>' + S.selectMonth + '</label>' +
            '<select id="dashboardMonthSelect">' + monthsHtml + '</select>' +
        '</div>' +
        '<div class="admin-stats">' +
            '<div class="stat-card stat-card--income"><h3>' + S.todaySales + '</h3><div class="stat-value" id="todaySales">0 IQD</div></div>' +
            '<div class="stat-card stat-card--expense"><h3>' + S.todayExpenses + '</h3><div class="stat-value" id="todayExpenses">0 IQD</div></div>' +
            '<div class="stat-card stat-card--net"><h3>' + S.netIncome + '</h3><div class="stat-value" id="todayNet">0 IQD</div></div>' +
            '<div class="stat-card"><h3>' + S.todayOrders + '</h3><div class="stat-value" id="todayOrders">0</div></div>' +
        '</div>' +
        '<div class="admin-stats" style="margin-top:16px;">' +
            '<div class="stat-card stat-card--income"><h3>' + S.monthlySales + '</h3><div class="stat-value" id="monthlySales">0 IQD</div></div>' +
            '<div class="stat-card stat-card--expense"><h3>' + S.monthlyExpenses + '</h3><div class="stat-value" id="monthlyExpenses">0 IQD</div></div>' +
            '<div class="stat-card stat-card--net"><h3>' + S.netIncome + '</h3><div class="stat-value" id="monthlyNet">0 IQD</div></div>' +
            '<div class="stat-card"><h3>' + S.bestSelling + '</h3><div class="stat-value" id="bestSelling">-</div></div>' +
        '</div>' +
        '<div class="card">' +
            '<h2>' + S.dailySales + ' — <span id="dailySalesMonthLabel"></span></h2>' +
            '<div id="dailySalesContainer"><div class="loading">Loading...</div></div>' +
        '</div>' +
        '<div class="card" style="margin-top:20px;">' +
            '<h2>' + S.recentSales + '</h2>' +
            '<div id="recentSalesContainer"><div class="loading">Loading...</div></div>' +
        '</div>';
    var monthSelect = document.getElementById('dashboardMonthSelect');
    if (monthSelect) {
        monthSelect.addEventListener('change', function () {
            var m = parseInt(this.value, 10);
            loadDashboardStats(m);
            startDashboardListeners(m);
        });
    }
    loadDashboardStats(currentMonth);
    loadRecentSales();
    startDashboardListeners(currentMonth);
}

function paintDashboardFromCache(month) {
    if (month === undefined || month === null) month = new Date().getMonth();
    var year = new Date().getFullYear();
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;

    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    var mStart = new Date(year, month, 1);
    var mEnd = new Date(year, month + 1, 1);

    var todaySales = sumSalesInRange(today, tomorrow);
    var todayExp = sumExpensesInRange(today, tomorrow);
    var monthSales = sumSalesInRange(mStart, mEnd);
    var monthExp = sumExpensesInRange(mStart, mEnd);

    var elToday = document.getElementById('todaySales');
    if (elToday) elToday.textContent = todaySales.total.toLocaleString() + ' IQD';
    var elOrders = document.getElementById('todayOrders');
    if (elOrders) elOrders.textContent = todaySales.count.toString();
    var elTodayExp = document.getElementById('todayExpenses');
    if (elTodayExp) elTodayExp.textContent = todayExp.toLocaleString() + ' IQD';
    var elTodayNet = document.getElementById('todayNet');
    if (elTodayNet) elTodayNet.textContent = (todaySales.total - todayExp).toLocaleString() + ' IQD';
    var elM = document.getElementById('monthlySales');
    if (elM) elM.textContent = monthSales.total.toLocaleString() + ' IQD';
    var elMExp = document.getElementById('monthlyExpenses');
    if (elMExp) elMExp.textContent = monthExp.toLocaleString() + ' IQD';
    var elMNet = document.getElementById('monthlyNet');
    if (elMNet) elMNet.textContent = (monthSales.total - monthExp).toLocaleString() + ' IQD';

    document.getElementById('dailySalesMonthLabel').textContent = getMonthName(month, S);

    var dayTotals = {};
    var itemCounts = {};
    var lang = localStorage.getItem('selectedLang') || 'ku';
    readCachedSales().forEach(function (s) {
        var ms = saleTimestampToMs(s);
        if (ms < mStart.getTime() || ms >= mEnd.getTime()) return;
        var saleDate = new Date(ms);
        var dayKey = saleDate.getDate();
        dayTotals[dayKey] = (dayTotals[dayKey] || 0) + (s.total || 0);
        if (s.items) {
            s.items.forEach(function (it) {
                var itemName = it.name || it['name_' + lang] || it.name_en || '—';
                var qty = it.quantity || 1;
                if (!itemCounts[itemName]) itemCounts[itemName] = 0;
                itemCounts[itemName] += qty;
            });
        }
    });

    var bestName = '-';
    var bestQty = 0;
    Object.keys(itemCounts).forEach(function (name) {
        if (itemCounts[name] > bestQty) { bestQty = itemCounts[name]; bestName = name; }
    });
    var elB = document.getElementById('bestSelling');
    if (elB) {
        if (bestQty > 0) {
            elB.innerHTML = '<span class="best-item-name">' + bestName + '</span> <span class="best-item-qty">(' + bestQty + ' ' + S.sold + ')</span>';
        } else {
            elB.textContent = '-';
        }
    }

    if (readCachedSales().length > 0) {
        var daysInM = new Date(year, month + 1, 0).getDate();
        var html = '<table class="daily-sales-table"><thead><tr><th>Day</th><th>' + S.total + ' (IQD)</th></tr></thead><tbody>';
        for (var d = 1; d <= daysInM; d++) {
            var dTotal = dayTotals[d] || 0;
            var cls = dTotal > 0 ? 'day-sales' : 'day-sales zero';
            var isToday = (d === today.getDate() && month === today.getMonth());
            html += '<tr' + (isToday ? ' style="background:rgba(212,175,55,0.06);"' : '') + '><td>' + (isToday ? '<strong style="color:var(--gold);">' + d + ' ★</strong>' : d) + '</td><td class="' + cls + '">' + dTotal.toLocaleString() + ' IQD</td></tr>';
        }
        html += '</tbody></table>';
        var container = document.getElementById('dailySalesContainer');
        if (container && container.querySelector('.loading')) container.innerHTML = html;
    }
}

function stopDashboardListeners() {
    dashboardUnsubscribes.forEach(function (unsub) {
        try { unsub(); } catch (e) { /* ignore */ }
    });
    dashboardUnsubscribes = [];
}

function startDashboardListeners(month) {
    stopDashboardListeners();
    if (!window.db || !document.getElementById('dashboardMonthSelect')) return;
    if (!isAdminAuthenticated()) return;
    if (month === undefined || month === null) {
        var sel = document.getElementById('dashboardMonthSelect');
        month = sel ? parseInt(sel.value, 10) : new Date().getMonth();
    }
    var year = new Date().getFullYear();
    var mStart = new Date(year, month, 1);
    var mEnd = new Date(year, month + 1, 1);

    function refreshDashboard() {
        if (!document.getElementById('todaySales')) return;
        loadDashboardStats(month);
        loadRecentSales();
    }

    var salesUnsub = db.collection('sales')
        .where('timestamp', '>=', mStart)
        .where('timestamp', '<', mEnd)
        .onSnapshot(refreshDashboard, function (e) {
            console.error('Dashboard sales listener error:', e);
        });
    dashboardUnsubscribes.push(salesUnsub);

    var expUnsub = db.collection('expenses')
        .where('timestamp', '>=', mStart)
        .where('timestamp', '<', mEnd)
        .onSnapshot(refreshDashboard, function (e) {
            console.error('Dashboard expenses listener error:', e);
        });
    dashboardUnsubscribes.push(expUnsub);
}

function loadDashboardStats(month) {
    if (month === undefined || month === null) month = new Date().getMonth();
    var year = new Date().getFullYear();
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;

    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    var mStart = new Date(year, month, 1);
    var mEnd = new Date(year, month + 1, 1);

    document.getElementById('dailySalesMonthLabel').textContent = getMonthName(month, S);

    if (!isAdminAuthenticated()) {
        paintDashboardFromCache(month);
        return;
    }

    adminProtectedGet(db.collection('sales').where('timestamp', '>=', today).where('timestamp', '<', tomorrow)).then(function (snap) {
        mergeSalesSnapIntoCache(snap);
        var total = 0;
        snap.forEach(function (d) { total += (d.data().total || 0); });
        var el = document.getElementById('todaySales');
        if (el) el.textContent = total.toLocaleString() + ' IQD';
        var elOrders = document.getElementById('todayOrders');
        if (elOrders) elOrders.textContent = snap.size.toString();

        adminProtectedGet(db.collection('expenses').where('timestamp', '>=', today).where('timestamp', '<', tomorrow)).then(function (expSnap) {
            mergeExpensesSnapIntoCache(expSnap);
            var expTotal = 0;
            expSnap.forEach(function (d) { expTotal += (d.data().price || 0); });
            var elExp = document.getElementById('todayExpenses');
            if (elExp) elExp.textContent = expTotal.toLocaleString() + ' IQD';
            var elNet = document.getElementById('todayNet');
            if (elNet) elNet.textContent = (total - expTotal).toLocaleString() + ' IQD';
        }).catch(function (e) {
            console.error('[dashboard] today expenses:', e.message || e);
        });
    }).catch(function (e) {
        console.error('[dashboard] today sales:', e.message || e);
        if (!navigator.onLine) paintDashboardFromCache(month);
    });

    var monthlyTotal = 0;
    var dayTotals = {};
    var itemCounts = {};

    adminProtectedGet(db.collection('sales').where('timestamp', '>=', mStart).where('timestamp', '<', mEnd)).then(function (snap) {
        mergeSalesSnapIntoCache(snap);
        snap.forEach(function (d) {
            var sale = d.data();
            monthlyTotal += (sale.total || 0);
            var ts = sale.timestamp;
            var saleDate;
            if (ts && typeof ts.toDate === 'function') saleDate = ts.toDate();
            else if (ts && ts.seconds) saleDate = new Date(ts.seconds * 1000);
            else saleDate = new Date(ts);
            var dayKey = saleDate.getDate();
            dayTotals[dayKey] = (dayTotals[dayKey] || 0) + (sale.total || 0);
            if (sale.items) {
                sale.items.forEach(function (it) {
                    var itemName = it.name || it['name_' + (localStorage.getItem('selectedLang') || 'ku')] || it.name_en || '—';
                    var qty = it.quantity || 1;
                    if (!itemCounts[itemName]) itemCounts[itemName] = 0;
                    itemCounts[itemName] += qty;
                });
            }
        });
        var elM = document.getElementById('monthlySales');
        if (elM) elM.textContent = monthlyTotal.toLocaleString() + ' IQD';

        var bestName = '-';
        var bestQty = 0;
        Object.keys(itemCounts).forEach(function (name) {
            if (itemCounts[name] > bestQty) { bestQty = itemCounts[name]; bestName = name; }
        });
        var elB = document.getElementById('bestSelling');
        if (elB) {
            if (bestQty > 0) {
                elB.innerHTML = '<span class="best-item-name">' + bestName + '</span> <span class="best-item-qty">(' + bestQty + ' ' + S.sold + ')</span>';
            } else {
                elB.textContent = '-';
            }
        }

        var daysInM = new Date(year, month + 1, 0).getDate();
        var html = '<table class="daily-sales-table"><thead><tr><th>Day</th><th>' + S.total + ' (IQD)</th></tr></thead><tbody>';
        for (var d = 1; d <= daysInM; d++) {
            var dTotal = dayTotals[d] || 0;
            var cls = dTotal > 0 ? 'day-sales' : 'day-sales zero';
            var isToday = (d === today.getDate() && month === today.getMonth());
            html += '<tr' + (isToday ? ' style="background:rgba(212,175,55,0.06);"' : '') + '><td>' + (isToday ? '<strong style="color:var(--gold);">' + d + ' ★</strong>' : d) + '</td><td class="' + cls + '">' + dTotal.toLocaleString() + ' IQD</td></tr>';
        }
        html += '</tbody></table>';
        var container = document.getElementById('dailySalesContainer');
        if (container) container.innerHTML = html;

        adminProtectedGet(db.collection('expenses').where('timestamp', '>=', mStart).where('timestamp', '<', mEnd)).then(function (expSnap) {
            mergeExpensesSnapIntoCache(expSnap);
            var expTotal = 0;
            expSnap.forEach(function (d) { expTotal += (d.data().price || 0); });
            var elExp = document.getElementById('monthlyExpenses');
            if (elExp) elExp.textContent = expTotal.toLocaleString() + ' IQD';
            var elNet = document.getElementById('monthlyNet');
            if (elNet) elNet.textContent = (monthlyTotal - expTotal).toLocaleString() + ' IQD';
        }).catch(function (e) {
            console.error('[dashboard] monthly expenses:', e.message || e);
        });
    }).catch(function (e) {
        console.error('[dashboard] monthly sales:', e.message || e);
        if (!navigator.onLine) {
            paintDashboardFromCache(month);
        } else {
            clearAdminLoadingEl('dailySalesContainer', '<p style="color:#C62828;padding:16px;">' + S.errorPrefix + (e.message || 'Could not load sales') + '</p>');
        }
    });
}

function loadRecentSales() {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var container = document.getElementById('recentSalesContainer');
    if (!container) return;

    if (!isAdminAuthenticated()) {
        var cached = readCachedSales().slice().sort(function (a, b) {
            return saleTimestampToMs(b) - saleTimestampToMs(a);
        }).slice(0, 5);
        if (cached.length > 0) renderRecentSalesTable(cached, S, container);
        else container.innerHTML = '<p style="color:#888;padding:16px;">' + S.noSalesData + '</p>';
        return;
    }

    adminProtectedGet(db.collection('sales').orderBy('timestamp', 'desc').limit(5)).then(function (snap) {
        mergeSalesSnapIntoCache(snap);
        if (snap.empty) {
            container.innerHTML = '<p style="color:#888;padding:16px;">' + S.noSalesYet + '</p>';
            return;
        }
        var rows = [];
        snap.forEach(function (doc) { rows.push(saleEntryFromDoc(doc)); });
        renderRecentSalesTable(rows, S, container);
    }).catch(function (e) {
        console.error('[dashboard] recent sales:', e.message || e);
        container.innerHTML = '<p style="color:#C62828;padding:16px;">' + S.errorPrefix + (e.message || '') + '</p>';
    });
}

function renderRecentSalesTable(sales, S, container) {
    var html = '<div class="table-responsive"><table class="admin-table"><thead><tr><th>' + S.time + '</th><th>' + S.items + '</th><th>' + S.total + ' (IQD)</th></tr></thead><tbody>';
    sales.forEach(function (sale) {
        var cnt = sale.items ? sale.items.reduce(function (s, i) { return s + (i.quantity || 1); }, 0) : 0;
        var tsMs = saleTimestampToMs(sale);
        var timeStr = tsMs ? new Date(tsMs).toLocaleTimeString() : '—';
        html += '<tr><td>' + timeStr + '</td><td>' + cnt + S.itemsCount + '</td><td>' + (sale.total || 0) + ' IQD</td></tr>';
    });
    html += '</tbody></table></div>';
    container.innerHTML = html;
}

/* ============ MANAGE ITEMS ============ */

function readCachedCategories() {
    try {
        return JSON.parse(localStorage.getItem('cachedCategories') || '[]');
    } catch (e) {
        return [];
    }
}

function upsertCachedCategory(id, data) {
    if (!id) return;
    var cats = readCachedCategories();
    var idx = -1;
    for (var i = 0; i < cats.length; i++) {
        if (cats[i].id === id) { idx = i; break; }
    }
    var entry = { id: id, data: data };
    if (idx >= 0) cats[idx] = entry;
    else cats.push(entry);
    localStorage.setItem('cachedCategories', JSON.stringify(cats));
}

function refreshCategoriesCache(callback) {
    if (!window.db) {
        if (callback) callback(readCachedCategories());
        return;
    }
    db.collection('categories').get().then(function (snap) {
        var categories = [];
        snap.forEach(function (doc) {
            categories.push({ id: doc.id, data: doc.data() });
        });
        localStorage.setItem('cachedCategories', JSON.stringify(categories));
        if (callback) callback(categories);
    }).catch(function () {
        if (callback) callback(readCachedCategories());
    });
}

function buildCategoryMapFromCache() {
    var catMap = {};
    readCachedCategories().forEach(function (c) {
        if (c && c.id) catMap[c.id] = c.data || {};
    });
    return catMap;
}

function getCategoryLabel(categoryId, lang, catMap) {
    if (!categoryId) return '-';
    lang = lang || localStorage.getItem('selectedLang') || 'ku';
    var data = (catMap && catMap[categoryId]) || null;
    if (!data) {
        readCachedCategories().some(function (c) {
            if (c.id === categoryId) { data = c.data; return true; }
            return false;
        });
    }
    if (data) {
        return data['name_' + lang] || data.name_en || data.name_ku || data.name_ar || categoryId;
    }
    if (typeof getCategoryDisplayName === 'function') {
        var resolved = getCategoryDisplayName(categoryId, lang);
        if (resolved && resolved !== categoryId) return resolved;
    }
    return categoryId;
}

function loadManageItems() {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    itemsActiveCategory = 'all';
    var adminContent = document.getElementById('adminContent');
    adminContent.innerHTML =
        '<div class="card">' +
            '<h2>' + S.manageItems + ' <small style="opacity:0.45;font-size:0.75rem;font-weight:400">' + ADMIN_VERSION + '</small></h2>' +
            '<button class="btn-primary" id="addItemBtn" style="margin-bottom:16px;">' + S.addNewItem + '</button>' +
            '<div class="form-group"><input type="text" id="itemSearch" placeholder="' + S.searchItems + '"></div>' +
            '<div class="form-group admin-items-cat-filter">' +
                '<div class="admin-cat-picker" id="itemsCatPicker">' +
                    '<button type="button" class="admin-cat-picker-btn" id="itemsCatPickerBtn" aria-expanded="false">' +
                        '<span class="admin-cat-picker-label" id="itemsCatPickerLabel">' + escapeHtmlText(S.allCategories) + '</span>' +
                        '<span class="admin-cat-picker-chevron" aria-hidden="true">▾</span>' +
                    '</button>' +
                    '<div class="admin-cat-picker-panel" id="itemsCatPickerPanel" hidden>' +
                        '<div class="admin-menu-category-bar">' +
                            '<div class="admin-category-scroll" id="itemsCategoryScroll"></div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                '<input type="hidden" id="categoryFilter" value="all">' +
            '</div>' +
            '<div id="itemsList"><div class="loading">Loading...</div></div>' +
        '</div>' +
        '<div id="itemModal" class="modal-overlay">' +
            '<div class="modal">' +
                '<div class="modal-content">' +
                    '<span class="modal-close" id="modalClose">&times;</span>' +
                    '<h2 id="modalTitle">' + S.addNewItem + '</h2>' +
                    '<form id="itemForm">' +
                        '<div class="form-group"><label>' + S.kurdishName + '</label><input type="text" id="itemNameKu" required></div>' +
                        '<div class="form-group"><label>' + S.arabicName + '</label><input type="text" id="itemNameAr" required></div>' +
                        '<div class="form-group"><label>' + S.englishName + '</label><input type="text" id="itemNameEn" required></div>' +
                        '<div class="form-group"><label>' + S.kurdishDesc + '</label><textarea id="itemDescKu" rows="2"></textarea></div>' +
                        '<div class="form-group"><label>' + S.arabicDesc + '</label><textarea id="itemDescAr" rows="2"></textarea></div>' +
                        '<div class="form-group"><label>' + S.englishDesc + '</label><textarea id="itemDescEn" rows="2"></textarea></div>' +
                        '<div class="form-group"><label>' + S.imageURL + '</label>' +
                            '<input type="file" accept="image/*" id="itemImageFile" style="margin-bottom:6px;">' +
                            '<input type="text" id="itemImageURL" placeholder="' + (S.imageUrlOrUpload || 'Paste image URL or upload above') + '">' +
                            '<img id="itemImagePreview" style="display:none;margin-top:8px;max-height:120px;border-radius:8px;"></div>' +
                        '<div class="form-group"><label>' + S.price + '</label><input type="number" id="itemPrice" min="0" required></div>' +
                        '<div class="form-group"><label>' + S.category + '</label>' +
                            '<div style="display:flex;gap:8px;">' +
                                '<select id="itemCategory" required style="flex:1;">' +
                                    '<option value="">' + S.select + '</option>' +
                                '</select>' +
                                '<button type="button" class="btn-primary" id="addNewCategoryBtn" style="padding:8px 12px;">+</button>' +
                            '</div>' +
                        '</div>' +
                        '<div class="form-group"><label><input type="checkbox" id="itemAvailable" checked> ' + S.available + '</label></div>' +
                        '<button type="submit" class="btn-primary">' + S.saveItem + '</button>' +
                        '<button type="button" class="btn-secondary" id="cancelItemBtn" style="margin-left:8px;">' + S.cancel + '</button>' +
                        '<input type="hidden" id="itemId" value="">' +
                    '</form>' +
                '</div>' +
            '</div>' +
        '</div>' +
        '<div id="quickCategoryModal" class="modal-overlay">' +
            '<div class="modal">' +
                '<div class="modal-content">' +
                    '<span class="modal-close" id="quickCategoryModalClose">&times;</span>' +
                    '<h2>' + S.createNewCategory + '</h2>' +
                    '<form id="quickCategoryForm">' +
                        '<div class="form-group"><label>' + S.categoryNameKu + '</label><input type="text" id="quickCategoryNameKu" required></div>' +
                        '<div class="form-group"><label>' + S.categoryNameAr + '</label><input type="text" id="quickCategoryNameAr" required></div>' +
                        '<div class="form-group"><label>' + S.categoryNameEn + '</label><input type="text" id="quickCategoryNameEn" required></div>' +
                        '<div class="form-group"><label>' + S.categoryImage + '</label><input type="url" id="quickCategoryImageURL" placeholder="https://..."></div>' +
                        '<button type="submit" class="btn-primary">' + S.saveCategory + '</button>' +
                        '<button type="button" class="btn-secondary" id="cancelQuickCategoryBtn" style="margin-left:8px;">' + S.cancel + '</button>' +
                    '</form>' +
                '</div>' +
            '</div>' +
        '</div>';
    loadCategoriesDropdown();
    loadCategoryFilter();
    refreshCategoriesCache();
    wireItemEvents();
    hydrateItemsUiFromCache();
    startItemsListener();
}

function stopItemsListener() {
    if (itemsUnsubscribe) {
        try { itemsUnsubscribe(); } catch (e) { /* ignore */ }
        itemsUnsubscribe = null;
    }
    _itemsSnapDocs = [];
}

function collectItemDocsFromSnap(snap) {
    var docs = [];
    snap.forEach(function (d) {
        var data = d.data();
        if (data.category === 'Water') return;
        docs.push(d);
    });
    return docs;
}

function filterItemDocs(docs, searchTerm, cat) {
    var filtered = docs.slice();
    if (searchTerm) {
        var lang = localStorage.getItem('selectedLang') || 'ku';
        var term = searchTerm.toLowerCase();
        filtered = filtered.filter(function (d) {
            var item = d.data();
            var name = (item['name_' + lang] || item.name_en || '').toLowerCase();
            return name.indexOf(term) !== -1;
        });
    }
    if (cat && cat !== 'all') {
        filtered = filtered.filter(function (d) { return d.data().category === cat; });
    }
    return filtered;
}

function startItemsListener() {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    if (!document.getElementById('itemsList')) return;

    if (itemsUnsubscribe) {
        try { itemsUnsubscribe(); } catch (e) { /* ignore */ }
        itemsUnsubscribe = null;
    }

    hydrateItemsUiFromCache();

    if (!window.db) {
        if (!_itemsSnapDocs.length) {
            clearAdminLoadingEl('itemsList', '<p>' + S.noItemsFound + '</p>');
        }
        return;
    }

    function applyItemsSnap(snap) {
        _itemsSnapDocs = collectItemDocsFromSnap(snap);
        refreshCategoryFilterOptions();
        refreshItemCategoryDropdown();
        var searchEl = document.getElementById('itemSearch');
        var catEl = document.getElementById('categoryFilter');
        var searchTerm = searchEl ? searchEl.value : '';
        var cat = catEl ? catEl.value : itemsActiveCategory;
        renderItemsList(filterItemDocs(_itemsSnapDocs, searchTerm, cat));

        var cashierCache = [];
        var menuCache = [];
        snap.forEach(function (d) {
            var data = d.data();
            cashierCache.push({ id: d.id, v: data });
            menuCache.push(Object.assign({ id: d.id }, data));
        });
        localStorage.setItem('cachedCashierItems', JSON.stringify(cashierCache));
        writeCachedMenuItemsFlat(menuCache);

        var catNames = {};
        _itemsSnapDocs.forEach(function (d) {
            var c = d.data().category;
            if (c && c !== 'Water') catNames[c] = true;
        });
        localStorage.setItem('cachedMenuCategoryNames', JSON.stringify(Object.keys(catNames)));
    }

    adminGetWithTimeout(db.collection('menuItems'), 8000).then(applyItemsSnap).catch(function (e) {
        console.warn('[admin items] get failed:', e.message);
        if (!hydrateItemsUiFromCache()) {
            clearAdminLoadingEl('itemsList', '<p style="color:#C62828;">' + S.errorPrefix + (S.menuConnectionHint || 'Check connection') + '</p>');
        }
    });

    setTimeout(function () {
        if (!adminSectionStillLoading('itemsList')) return;
        if (hydrateItemsUiFromCache()) return;
        clearAdminLoadingEl('itemsList', '<p>' + S.noItemsFound + '</p>');
    }, 10000);

    itemsUnsubscribe = db.collection('menuItems').onSnapshot(function (snap) {
        applyItemsSnap(snap);
    }, function (e) {
        console.error('Items listener error:', e);
        if (!hydrateItemsUiFromCache()) {
            clearAdminLoadingEl('itemsList', '<p style="color:#C62828;">' + S.errorPrefix + e.message + '</p>');
        }
    });
}

function loadItemsList() {
     var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
     if (hydrateItemsUiFromCache()) {
         loadCategoryFilter();
         return;
     }
     if (!window.db) {
         var el = document.getElementById('itemsList');
         if (el) el.innerHTML = '<p>' + S.noItemsFound + '</p>';
         return;
     }
     adminGetWithTimeout(db.collection('menuItems'), 8000).then(function (snap) {
         var docs = [];
         snap.forEach(function (d) { var data = d.data(); if (data.category !== 'Water') { docs.push(d); } });
         _itemsSnapDocs = docs;
         renderItemsList(docs);
         loadCategoryFilter();
    }).catch(function (e) {
        if (hydrateItemsUiFromCache()) return;
        var el = document.getElementById('itemsList');
         if (el) el.innerHTML = '<p style="color:#C62828;">' + S.errorPrefix + e.message + '</p>';
    });
}

function loadCategoriesDropdown() {
    var select = document.getElementById('itemCategory');
    if (!select) return Promise.resolve();

    if (!window.db) {
        refreshItemCategoryDropdown();
        return Promise.resolve();
    }

    return adminGetWithTimeout(db.collection('categories'), 8000).then(function (snap) {
        var categories = [];
        snap.forEach(function (doc) {
            categories.push({ id: doc.id, data: doc.data() });
        });
        localStorage.setItem('cachedCategories', JSON.stringify(categories));
        refreshItemCategoryDropdown();
    }).catch(function (e) {
        console.error('Error loading categories:', e);
        refreshItemCategoryDropdown();
    });
}

function loadCategoriesFromCache() {
    refreshItemCategoryDropdown();
}

function escapeHtmlAttr(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;');
}

function escapeHtmlText(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getUniqueItemCategoryIds(docs) {
    var names = {};
    (docs || []).forEach(function (d) {
        var c = typeof d.data === 'function' ? d.data().category : (d.category || null);
        if (c && c !== 'Water') names[c] = true;
    });
    return Object.keys(names);
}

function getAllItemCategoryIdsForFilter() {
    var names = {};
    function addName(c) {
        if (c && c !== 'Water') names[c] = true;
    }
    getUniqueItemCategoryIds(_itemsSnapDocs).forEach(addName);
    readCachedCategories().forEach(function (c) {
        if (c && c.id) addName(c.id);
    });
    try {
        JSON.parse(localStorage.getItem('cachedMenuItems') || '[]').forEach(function (it) {
            addName(it.category);
        });
    } catch (e) {}
    try {
        JSON.parse(localStorage.getItem('cachedCashierItems') || '[]').forEach(function (it) {
            addName(it.v && it.v.category);
        });
    } catch (e) {}
    try {
        JSON.parse(localStorage.getItem('cachedMenuCategoryNames') || '[]').forEach(addName);
    } catch (e) {}
    return Object.keys(names).sort();
}

function buildCategorySelectOptions(categories, itemCategoryIds, lang, S, allOption) {
    var seen = {};
    var html = allOption ? '<option value="all">' + S.allCategories + '</option>' : '<option value="">' + S.select + '</option>';
    (categories || []).forEach(function (c) {
        if (!c || !c.id || seen[c.id]) return;
        seen[c.id] = true;
        var cat = c.data || {};
        var name = cat['name_' + lang] || cat.name_en || cat.name_ku || cat.name_ar || c.id || S.unnamed;
        html += '<option value="' + escapeHtmlAttr(c.id) + '">' + escapeHtmlText(name) + '</option>';
    });
    (itemCategoryIds || []).forEach(function (id) {
        if (!id || seen[id]) return;
        seen[id] = true;
        var label = getCategoryLabel(id, lang, buildCategoryMapFromCache());
        html += '<option value="' + escapeHtmlAttr(id) + '">' + escapeHtmlText(label) + '</option>';
    });
    return html;
}

function adminAllCategoryIconSvg() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
        '<path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4l1.4-1.4M17 7l1.4-1.4"/>' +
        '<circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/></svg>';
}

function getAdminCategoryIcon(catId, catMap) {
    var data = catMap && catMap[catId];
    if (data && data.image) {
        return '<img class="cat-icon" src="' + escapeHtmlAttr(data.image) + '" alt="" onerror="this.onerror=null;this.style.display=\'none\'">';
    }
    return '<svg class="cat-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/></svg>';
}

function closeItemsCatPicker() {
    var panel = document.getElementById('itemsCatPickerPanel');
    var btn = document.getElementById('itemsCatPickerBtn');
    if (panel) panel.hidden = true;
    if (btn) btn.setAttribute('aria-expanded', 'false');
}

function openItemsCatPicker() {
    var panel = document.getElementById('itemsCatPickerPanel');
    var btn = document.getElementById('itemsCatPickerBtn');
    if (panel) panel.hidden = false;
    if (btn) btn.setAttribute('aria-expanded', 'true');
}

function updateItemsCatPickerLabel() {
    var labelEl = document.getElementById('itemsCatPickerLabel');
    if (!labelEl) return;
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var lang = localStorage.getItem('selectedLang') || 'ku';
    if (itemsActiveCategory === 'all') {
        labelEl.textContent = S.allCategories;
        return;
    }
    labelEl.textContent = getCategoryLabel(itemsActiveCategory, lang, buildCategoryMapFromCache());
}

function selectItemsCategory(catId) {
    itemsActiveCategory = catId || 'all';
    var cf = document.getElementById('categoryFilter');
    if (cf) cf.value = itemsActiveCategory;
    updateItemsCatPickerLabel();
    renderItemsCategoryBar();
    closeItemsCatPicker();
    var search = document.getElementById('itemSearch');
    applyItemFilter(search ? search.value : '', itemsActiveCategory);
}

function renderItemsCategoryBar() {
    var scroll = document.getElementById('itemsCategoryScroll');
    if (!scroll) return;
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var lang = localStorage.getItem('selectedLang') || 'ku';
    var catMap = buildCategoryMapFromCache();
    var cats = getAllItemCategoryIdsForFilter();
    var active = itemsActiveCategory || 'all';

    var html = '<button type="button" class="category-btn category-btn-all' + (active === 'all' ? ' active' : '') + '" data-cat="all">' +
        '<span class="cat-all-mark" aria-hidden="true">' + adminAllCategoryIconSvg() + '</span>' +
        '<span class="cat-label">' + escapeHtmlText(S.allCategories) + '</span></button>';

    cats.forEach(function (id) {
        var label = getCategoryLabel(id, lang, catMap);
        var icon = getAdminCategoryIcon(id, catMap);
        html += '<button type="button" class="category-btn' + (active === id ? ' active' : '') + '" data-cat="' + escapeHtmlAttr(id) + '">' +
            icon + '<span class="cat-label">' + escapeHtmlText(label) + '</span></button>';
    });

    if (!cats.length) {
        html += '<span class="items-cat-empty">' + escapeHtmlText(S.noCategories || 'No categories yet') + '</span>';
    }

    scroll.innerHTML = html;
    scroll.querySelectorAll('.category-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            selectItemsCategory(this.getAttribute('data-cat') || 'all');
        });
    });
    updateItemsCatPickerLabel();
}

function refreshCategoryFilterOptions() {
    renderItemsCategoryBar();
}

function refreshItemCategoryDropdown() {
    var select = document.getElementById('itemCategory');
    if (!select) return;
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var lang = localStorage.getItem('selectedLang') || 'ku';
    var prev = select.value;
    select.innerHTML = buildCategorySelectOptions(
        readCachedCategories(),
        getAllItemCategoryIdsForFilter(),
        lang,
        S,
        false
    );
    for (var i = 0; i < select.options.length; i++) {
        if (select.options[i].value === prev) {
            select.selectedIndex = i;
            break;
        }
    }
}

function loadCategoryFilter() {
    var cf = document.getElementById('categoryFilter');
    if (!cf) return;

    if (!window.db) {
        refreshCategoryFilterOptions();
        return;
    }

    adminGetWithTimeout(db.collection('categories'), 8000).then(function (snap) {
        var categories = [];
        snap.forEach(function (doc) {
            categories.push({ id: doc.id, data: doc.data() });
        });
        localStorage.setItem('cachedCategories', JSON.stringify(categories));
        refreshCategoryFilterOptions();
    }).catch(function (e) {
        console.error('Error loading category filter:', e);
        refreshCategoryFilterOptions();
    });
}

function renderItemsList(items) {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var list = document.getElementById('itemsList');
    if (!list) return;
    if (items.length === 0) {
        list.innerHTML = '<p>' + S.noItemsFound + '</p>';
        return;
    }

    var lang = localStorage.getItem('selectedLang') || 'ku';

    function paintRows(catMap) {
        var html = '<div class="table-responsive"><table class="admin-table"><thead><tr><th>Image</th><th>Name</th><th>' + S.category + '</th><th>' + S.price + '</th><th>' + S.available + '</th><th>Actions</th></tr></thead><tbody>';
        items.forEach(function (doc) {
            var item = doc.data();
            var name = item['name_' + lang] || item.name_ku || item.name_ar || item.name_en || S.unnamed;
            var img = item.image || 'https://placehold.co/50x50?text=No+Image';
            var avail = item.available ? '<span style="color:#2E7D32;">' + S.yes + '</span>' : '<span style="color:#C62828;">' + S.no + '</span>';
            var catName = getCategoryLabel(item.category, lang, catMap);
            html += '<tr>' +
                '<td><img src="' + img + '" alt="' + name + '" width="48" height="48"></td>' +
                '<td>' + name + '</td>' +
                '<td>' + catName + '</td>' +
                '<td>' + (item.price || 0) + ' IQD</td>' +
                '<td>' + avail + '</td>' +
                '<td><button class="btn-primary btn-sm edit-item" data-id="' + doc.id + '">' + S.edit + '</button> ' +
                '<button class="btn-danger btn-sm delete-item" data-id="' + doc.id + '">' + S.delete + '</button></td>' +
            '</tr>';
        });
        html += '</tbody></table></div>';
        list.innerHTML = html;

        list.querySelectorAll('.edit-item').forEach(function (btn) {
            btn.addEventListener('click', function () { editItem(this.getAttribute('data-id')); });
        });
        list.querySelectorAll('.delete-item').forEach(function (btn) {
            btn.addEventListener('click', function () { deleteItem(this.getAttribute('data-id')); });
        });
    }

    // Paint immediately — do not wait for categories fetch (was causing infinite Loading...).
    paintRows(buildCategoryMapFromCache());

    if (!window.db) return;

    adminGetWithTimeout(db.collection('categories'), 5000).then(function (catSnap) {
        var catMap = {};
        var categories = [];
        catSnap.forEach(function (catDoc) {
            catMap[catDoc.id] = catDoc.data();
            categories.push({ id: catDoc.id, data: catDoc.data() });
        });
        localStorage.setItem('cachedCategories', JSON.stringify(categories));
        paintRows(catMap);
    }).catch(function () {
        paintRows(buildCategoryMapFromCache());
    });
}

function wireItemEvents() {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var addBtn = document.getElementById('addItemBtn');
    if (addBtn) {
        addBtn.addEventListener('click', function () {
            document.getElementById('modalTitle').textContent = S.addNewItem;
            document.getElementById('itemForm').reset();
            document.getElementById('itemId').value = '';
            document.getElementById('itemAvailable').checked = true;
            var pr = document.getElementById('itemImagePreview');
            if (pr) pr.style.display = 'none';
            var modal = document.getElementById('itemModal');
            modal.classList.add('active');
            activeItemModal = modal;
            loadCategoriesDropdown();
        });
    }

    var closeBtn = document.getElementById('modalClose');
    if (closeBtn) {
        closeBtn.addEventListener('click', function () {
            document.getElementById('itemModal').classList.remove('active');
            activeItemModal = null;
        });
    }

    var cancelBtn = document.getElementById('cancelItemBtn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', function () {
            document.getElementById('itemModal').classList.remove('active');
            activeItemModal = null;
        });
    }

    var form = document.getElementById('itemForm');
    if (form) {
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            saveItem();
        });
    }

    var imgInput = document.getElementById('itemImageURL');
    if (imgInput) {
        imgInput.addEventListener('input', function () {
            var pr = document.getElementById('itemImagePreview');
            if (!pr) return;
            var url = this.value.trim();
            if (url) { pr.src = url; pr.style.display = 'block'; }
            else { pr.style.display = 'none'; }
        });
    }
    wireImageFileInput('itemImageFile', 'itemImageURL', 'itemImagePreview');

    var search = document.getElementById('itemSearch');
    if (search) {
        search.addEventListener('input', function () {
            applyItemFilter(search.value, itemsActiveCategory);
        });
    }

    var pickerBtn = document.getElementById('itemsCatPickerBtn');
    if (pickerBtn) {
        pickerBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            var panel = document.getElementById('itemsCatPickerPanel');
            if (panel && panel.hidden) openItemsCatPicker();
            else closeItemsCatPicker();
        });
    }
    if (!window._itemsCatPickerDocClick) {
        window._itemsCatPickerDocClick = true;
        document.addEventListener('click', function (e) {
            var root = document.getElementById('itemsCatPicker');
            if (!root || root.contains(e.target)) return;
            closeItemsCatPicker();
        });
    }

    // Quick category modal events
    var addNewCatBtn = document.getElementById('addNewCategoryBtn');
    if (addNewCatBtn) {
        addNewCatBtn.addEventListener('click', function () {
            document.getElementById('quickCategoryForm').reset();
            var modal = document.getElementById('quickCategoryModal');
            modal.classList.add('active');
        });
    }

    var quickCloseBtn = document.getElementById('quickCategoryModalClose');
    if (quickCloseBtn) {
        quickCloseBtn.addEventListener('click', function () {
            document.getElementById('quickCategoryModal').classList.remove('active');
        });
    }

    var quickCancelBtn = document.getElementById('cancelQuickCategoryBtn');
    if (quickCancelBtn) {
        quickCancelBtn.addEventListener('click', function () {
            document.getElementById('quickCategoryModal').classList.remove('active');
        });
    }

    var quickForm = document.getElementById('quickCategoryForm');
    if (quickForm) {
        quickForm.addEventListener('submit', function (e) {
            e.preventDefault();
            saveQuickCategory();
        });
    }
}

function applyItemFilter(searchTerm, cat) {
    cat = cat || itemsActiveCategory || 'all';
    if (_itemsSnapDocs.length > 0) {
        renderItemsList(filterItemDocs(_itemsSnapDocs, searchTerm, cat));
        return;
    }
    db.collection('menuItems').get().then(function (snap) {
        var docs = snap.docs.filter(function (d) { return d.data().category !== 'Water'; });
        if (searchTerm) {
            var lang = localStorage.getItem('selectedLang') || 'ku';
            var term = searchTerm.toLowerCase();
            docs = docs.filter(function (d) {
                var item = d.data();
                var name = (item['name_' + lang] || item.name_en || '').toLowerCase();
                return name.indexOf(term) !== -1;
            });
        }
        if (cat && cat !== 'all') {
            docs = docs.filter(function (d) { return d.data().category === cat; });
        }
        renderItemsList(docs);
    });
}

/* Offline-resilient write helper.
   Firestore writes are applied to the local cache instantly and synced to the
   server once a connection is available. The promise from add/update/delete/
   commit only resolves AFTER the server confirms — which never happens while
   offline. So we run the success UI immediately (the data is already saved
   locally) and just log any real sync failure. This keeps the entire dashboard
   usable with no internet. */
function applyWrite(promise, onDone, onError) {
    try { if (typeof onDone === 'function') onDone(); }
    catch (e) { console.error('UI update error after write:', e); }
    if (promise && typeof promise.catch === 'function') {
        promise.catch(function (err) {
            console.error('Firestore sync error (will retry when online):', err);
            if (typeof onError === 'function') onError(err);
        });
    }
}

/* Convert a chosen image file into a small base64 data URL so it is stored
   directly inside the document — no upload server, no image hosting, and no
   internet required. It shows even when fully offline. The image is resized to
   max 500px and JPEG-compressed to stay well under Firestore's ~1MB limit. */
function fileToCompressedDataURL(file, maxDim, quality) {
    maxDim = maxDim || 500;
    quality = quality || 0.7;
    return new Promise(function (resolve, reject) {
        if (!file || !/^image\//.test(file.type)) { reject(new Error('Please choose an image file')); return; }
        // Keep transparency for non-JPEG sources (PNG/WebP/GIF/SVG icons) by
        // exporting PNG — JPEG has no alpha and would turn transparent areas
        // into an ugly black background. Photos (JPEG) stay JPEG to keep size down.
        var keepAlpha = file.type !== 'image/jpeg' && file.type !== 'image/jpg';
        var reader = new FileReader();
        reader.onload = function () {
            var img = new Image();
            img.onload = function () {
                var w = img.width, h = img.height;
                if (w > h && w > maxDim) { h = Math.round(h * maxDim / w); w = maxDim; }
                else if (h >= w && h > maxDim) { w = Math.round(w * maxDim / h); h = maxDim; }
                var canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                var ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, w, h);
                ctx.drawImage(img, 0, 0, w, h);
                try {
                    resolve(keepAlpha
                        ? canvas.toDataURL('image/png')
                        : canvas.toDataURL('image/jpeg', quality));
                } catch (e) { reject(e); }
            };
            img.onerror = function () { reject(new Error('Could not load that image')); };
            img.src = reader.result;
        };
        reader.onerror = function () { reject(new Error('Could not read that file')); };
        reader.readAsDataURL(file);
    });
}

/* Picking a file fills the given (hidden/url) input with the compressed data
   URL and updates the preview image. */
function wireImageFileInput(fileInputId, targetInputId, previewId) {
    var fileInput = document.getElementById(fileInputId);
    if (!fileInput) return;
    fileInput.addEventListener('change', function () {
        var file = fileInput.files && fileInput.files[0];
        if (!file) return;
        fileToCompressedDataURL(file).then(function (dataUrl) {
            var target = document.getElementById(targetInputId);
            if (target) target.value = dataUrl;
            var preview = document.getElementById(previewId);
            if (preview) { preview.src = dataUrl; preview.style.display = 'block'; }
        }).catch(function (e) {
            alert((e && e.message) || 'Image error');
        });
    });
}

function saveQuickCategory() {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var nameKu = document.getElementById('quickCategoryNameKu').value.trim();
    var nameAr = document.getElementById('quickCategoryNameAr').value.trim();
    var nameEn = document.getElementById('quickCategoryNameEn').value.trim();

    if (!nameKu || !nameAr || !nameEn) {
        alert(S.fillAll);
        return;
    }

    var imgUrl = document.getElementById('quickCategoryImageURL').value.trim();
    var placeholderImg = 'data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27400%27 height=%27300%27%3E%3Crect fill=%23e0e0e0 width=%27400%27 height=%27300%27/%3E%3Ctext x=%2750%25%27 y=%2750%25%27 font-size=%2724%27 text-anchor=%27middle%27 dy=%27.3em%27 fill=%23999%27%3ENo+Image%3C/text%3E%3C/svg%3E';
    var finalImg = imgUrl || placeholderImg;

    var categoryData = {
        name_ku: nameKu,
        name_ar: nameAr,
        name_en: nameEn,
        image: finalImg,
        created_at: firebase.firestore.FieldValue.serverTimestamp(),
        updated_at: firebase.firestore.FieldValue.serverTimestamp()
    };

    // Generate the doc id locally so we can select it immediately, even offline.
    var newCatRef = db.collection('categories').doc();
    applyWrite(newCatRef.set(categoryData), function () {
        upsertCachedCategory(newCatRef.id, categoryData);
        document.getElementById('quickCategoryModal').classList.remove('active');
        loadCategoriesDropdown();
        renderCategoriesListNow();
        var select = document.getElementById('itemCategory');
        if (select) { select.value = newCatRef.id; }
        alert(S.categorySaved);
    });
}

function saveItem() {
     var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
     var nameKu = document.getElementById('itemNameKu').value.trim();
    var nameAr = document.getElementById('itemNameAr').value.trim();
    var nameEn = document.getElementById('itemNameEn').value.trim();
    var price = document.getElementById('itemPrice').value.trim();
    var category = document.getElementById('itemCategory').value;

    if (!nameKu || !nameAr || !nameEn || !price || !category) {
        alert(S.fillAll);
        return;
    }

    var imgUrl = document.getElementById('itemImageURL').value.trim();
    var placeholderImg = 'data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27400%27 height=%27300%27%3E%3Crect fill=%23e0e0e0 width=%27400%27 height=%27300%27/%3E%3Ctext x=%2750%25%27 y=%2750%25%27 font-size=%2724%27 text-anchor=%27middle%27 dy=%27.3em%27 fill=%23999%27%3ENo+Image%3C/text%3E%3C/svg%3E';
    var finalImg = imgUrl || placeholderImg;

    var itemId = document.getElementById('itemId').value;
    var itemData = {
        name_ku: nameKu, name_ar: nameAr, name_en: nameEn,
        description_ku: document.getElementById('itemDescKu').value.trim(),
        description_ar: document.getElementById('itemDescAr').value.trim(),
        description_en: document.getElementById('itemDescEn').value.trim(),
        price: parseFloat(price) || 0,
        category: category,
        image: finalImg,
        available: document.getElementById('itemAvailable').checked,
        updated_at: firebase.firestore.FieldValue.serverTimestamp()
    };

    var ref;
    var promise;
    if (itemId) {
        ref = db.collection('menuItems').doc(itemId);
        promise = ref.update(itemData);
    } else {
        ref = db.collection('menuItems').doc();
        itemData.created_at = firebase.firestore.FieldValue.serverTimestamp();
        promise = ref.set(itemData);
    }

    applyWrite(promise, function () {
        upsertCachedMenuItem(ref.id, itemData);
        document.getElementById('itemModal').classList.remove('active');
        activeItemModal = null;
        hydrateItemsUiFromCache();
        alert(S.itemSaved);
    });
}

function editItem(itemId) {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;

    function openEditModal(item) {
        document.getElementById('itemId').value = itemId;
        document.getElementById('itemNameKu').value = item.name_ku || '';
        document.getElementById('itemNameAr').value = item.name_ar || '';
        document.getElementById('itemNameEn').value = item.name_en || '';
        document.getElementById('itemDescKu').value = item.description_ku || '';
        document.getElementById('itemDescAr').value = item.description_ar || '';
        document.getElementById('itemDescEn').value = item.description_en || '';
        document.getElementById('itemPrice').value = item.price || '';
        document.getElementById('itemAvailable').checked = item.available !== false;
        if (item.image) {
            document.getElementById('itemImageURL').value = item.image;
            var pr = document.getElementById('itemImagePreview');
            if (pr) { pr.src = item.image; pr.style.display = 'block'; }
        }
        document.getElementById('modalTitle').textContent = S.editItem;
        var modal = document.getElementById('itemModal');
        modal.classList.add('active');
        activeItemModal = modal;
        loadCategoriesDropdown().then(function () {
            document.getElementById('itemCategory').value = item.category || '';
        });
    }

    var cached = getMenuItemFromLocalCache(itemId);
    if (cached) openEditModal(cached);

    if (!window.db) {
        if (!cached) alert(S.noItemsFound);
        return;
    }

    db.collection('menuItems').doc(itemId).get().then(function (doc) {
        if (!doc.exists) {
            if (!cached) alert(S.noItemsFound);
            return;
        }
        openEditModal(doc.data());
    }).catch(function (e) {
        if (!cached) alert(S.errorPrefix + e.message);
    });
}

function deleteItem(itemId) {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    if (!confirm(S.deleteConfirm)) return;
    applyWrite(db.collection('menuItems').doc(itemId).delete(), function () {
        removeCachedMenuItem(itemId);
        hydrateItemsUiFromCache();
    });
}

/* ============ CATEGORIES ============ */

function mergeCategoryLists(serverCats, cachedCats) {
    var map = {};
    cachedCats.forEach(function (c) {
        if (c && c.id) map[c.id] = c;
    });
    serverCats.forEach(function (c) {
        if (c && c.id) map[c.id] = c;
    });
    return Object.keys(map).map(function (id) { return map[id]; });
}

function renderCategoriesListNow() {
    var cats = readCachedCategories();
    var have = {};
    cats.forEach(function (c) { have[c.id] = true; });
    renderCategoriesTable(mergeMenuCategories(cats, have));
}

function loadManageCategories() {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var adminContent = document.getElementById('adminContent');
    adminContent.innerHTML =
        '<div class="card">' +
            '<h2>' + S.manageCategories + '</h2>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">' +
                '<button class="btn-primary" id="addCategoryBtn">' + S.addCategory + '</button>' +
            '</div>' +
            '<div id="categoriesList"><div class="loading">Loading...</div></div>' +
        '</div>' +
        '<div id="categoryModal" class="modal-overlay">' +
            '<div class="modal">' +
                '<div class="modal-content">' +
                    '<span class="modal-close" id="categoryModalClose">&times;</span>' +
                    '<h2 id="categoryModalTitle">' + S.addCategory + '</h2>' +
                    '<form id="categoryForm">' +
                        '<div class="form-group"><label>' + S.categoryNameKu + '</label><input type="text" id="categoryNameKu" required></div>' +
                        '<div class="form-group"><label>' + S.categoryNameAr + '</label><input type="text" id="categoryNameAr" required></div>' +
                        '<div class="form-group"><label>' + S.categoryNameEn + '</label><input type="text" id="categoryNameEn" required></div>' +
                        '<div class="form-group"><label>' + S.categoryImage + '</label>' +
                            '<input type="file" accept="image/*" id="categoryImageFile" style="margin-bottom:6px;">' +
                            '<input type="text" id="categoryImageURL" placeholder="' + (S.imageUrlOrUpload || 'Paste image URL or upload above') + '">' +
                            '<img id="categoryImagePreview" style="display:none;margin-top:8px;max-height:120px;border-radius:8px;"></div>' +
                        '<button type="submit" class="btn-primary">' + S.saveCategory + '</button>' +
                        '<button type="button" class="btn-secondary" id="cancelCategoryBtn" style="margin-left:8px;">' + S.cancel + '</button>' +
                        '<input type="hidden" id="categoryId" value="">' +
                    '</form>' +
                '</div>' +
            '</div>' +
        '</div>';
    loadCategoriesList();
    wireCategoryEvents();
}

/* Distinct category names actually used by the menu items (so the manager can
   list/edit categories like "Coffee" even before a category document exists). */
function getMenuCategoryNames() {
    var names = {};
    try {
        JSON.parse(localStorage.getItem('cachedCashierItems') || '[]').forEach(function (it) {
            var c = it && it.v && it.v.category;
            if (c) names[c] = true;
        });
    } catch (e) {}
    try {
        JSON.parse(localStorage.getItem('cachedMenuCategoryNames') || '[]').forEach(function (n) {
            if (n) names[n] = true;
        });
    } catch (e) {}
    return names;
}

function renderCategoriesTable(categories) {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var list = document.getElementById('categoriesList');
    if (!list) return;
    var lang = localStorage.getItem('selectedLang') || 'ku';

    if (!categories.length) {
        list.innerHTML = '<p style="color:var(--text-muted);padding:8px 2px;">' + S.noCategories + '</p>';
        return;
    }

    var html = '<div class="table-responsive"><table class="admin-table"><thead><tr><th>' + (S.image || 'Image') + '</th><th>' + (S.name || 'Name') + '</th><th>' + (S.actions || 'Actions') + '</th></tr></thead><tbody>';
    categories.forEach(function (c) {
        var cat = c.data || {};
        var name = cat['name_' + lang] || cat.name_ku || cat.name_ar || cat.name_en || c.id || S.unnamed;
        var img = cat.image || 'https://placehold.co/50x50?text=No+Image';
        var virtualBadge = c.virtual ? ' <span class="cat-virtual-badge">' + (S.fromMenu || 'from menu') + '</span>' : '';
        var actions = '<button class="btn-primary btn-sm edit-category" data-id="' + c.id + '"' + (c.virtual ? ' data-virtual="1"' : '') + '>' + (c.virtual ? (S.addCategory || 'Add') : S.edit) + '</button>';
        if (!c.virtual) {
            actions += ' <button class="btn-danger btn-sm delete-category" data-id="' + c.id + '">' + S.delete + '</button>';
        }
        html += '<tr>' +
            '<td><img src="' + img + '" alt="" width="48" height="48" style="border-radius:8px;object-fit:cover;" onerror="this.src=\'https://placehold.co/50x50?text=Error\'"></td>' +
            '<td>' + name + virtualBadge + '</td>' +
            '<td>' + actions + '</td>' +
        '</tr>';
    });
    html += '</tbody></table></div>';
    list.innerHTML = html;

    list.querySelectorAll('.edit-category').forEach(function (btn) {
        btn.addEventListener('click', function () { editCategory(this.getAttribute('data-id')); });
    });
    list.querySelectorAll('.delete-category').forEach(function (btn) {
        btn.addEventListener('click', function () { deleteCategory(this.getAttribute('data-id')); });
    });
}

function mergeMenuCategories(realCats, haveIds) {
    var merged = realCats.slice();
    var lang = localStorage.getItem('selectedLang') || 'ku';
    var menuNames = getMenuCategoryNames();
    Object.keys(menuNames).forEach(function (name) {
        if (haveIds[name]) return;
        var label = getCategoryLabel(name, lang, buildCategoryMapFromCache());
        merged.push({
            id: name,
            data: { name_ku: label, name_ar: label, name_en: label, image: '' },
            virtual: true
        });
    });
    return merged;
}

function loadCategoriesList() {
    var list = document.getElementById('categoriesList');
    if (!list) return;

    // Show cached categories immediately (includes ones just saved offline).
    renderCategoriesListNow();
    clearAdminLoadingEl('categoriesList', '');

    if (!window.db) {
        if (!readCachedCategories().length) {
            clearAdminLoadingEl('categoriesList', '<p style="color:var(--text-muted);padding:8px 2px;">' + (i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en).noCategories + '</p>');
        }
        return;
    }

    adminGetWithTimeout(db.collection('categories'), 8000).then(function (snap) {
        var fromServer = [];
        snap.forEach(function (doc) {
            fromServer.push({ id: doc.id, data: doc.data() });
        });
        var merged = mergeCategoryLists(fromServer, readCachedCategories());
        localStorage.setItem('cachedCategories', JSON.stringify(merged));
        var have = {};
        merged.forEach(function (c) { have[c.id] = true; });
        renderCategoriesTable(mergeMenuCategories(merged, have));
    }).catch(function () {
        renderCategoriesListNow();
    });

    adminGetWithTimeout(db.collection('menuItems'), 8000).then(function (snap) {
        var names = {};
        snap.forEach(function (d) { var c = (d.data() || {}).category; if (c) names[c] = true; });
        localStorage.setItem('cachedMenuCategoryNames', JSON.stringify(Object.keys(names)));
        renderCategoriesListNow();
    }).catch(function () {});

    stopCategoriesListener();
    categoriesUnsubscribe = db.collection('categories').onSnapshot(function (snap) {
        var fromServer = [];
        snap.forEach(function (doc) {
            fromServer.push({ id: doc.id, data: doc.data() });
        });
        var merged = mergeCategoryLists(fromServer, readCachedCategories());
        localStorage.setItem('cachedCategories', JSON.stringify(merged));
        var have = {};
        merged.forEach(function (c) { have[c.id] = true; });
        renderCategoriesTable(mergeMenuCategories(merged, have));
    }, function (e) {
        console.error('Categories listener error, falling back to cache:', e);
        renderCategoriesListNow();
    });
}

function wireCategoryEvents() {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var addBtn = document.getElementById('addCategoryBtn');
    if (addBtn) {
        addBtn.addEventListener('click', function () {
            document.getElementById('categoryModalTitle').textContent = S.addCategory;
            document.getElementById('categoryForm').reset();
            document.getElementById('categoryId').value = '';
            var pr = document.getElementById('categoryImagePreview');
            if (pr) pr.style.display = 'none';
            var modal = document.getElementById('categoryModal');
            modal.classList.add('active');
        });
    }

    var closeBtn = document.getElementById('categoryModalClose');
    if (closeBtn) {
        closeBtn.addEventListener('click', function () {
            document.getElementById('categoryModal').classList.remove('active');
        });
    }

    var cancelBtn = document.getElementById('cancelCategoryBtn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', function () {
            document.getElementById('categoryModal').classList.remove('active');
        });
    }

    var form = document.getElementById('categoryForm');
    if (form) {
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            saveCategory();
        });
    }

    // Image URL preview with validation
    var imageInput = document.getElementById('categoryImageURL');
    if (imageInput) {
        imageInput.addEventListener('input', function () {
            var url = this.value.trim();
            var preview = document.getElementById('categoryImagePreview');
            if (url) {
                preview.src = url;
                preview.style.display = 'block';
                preview.onerror = function () {
                    console.error('Invalid image URL:', url);
                    this.style.display = 'none';
                };
            } else {
                preview.style.display = 'none';
            }
        });
    }
    wireImageFileInput('categoryImageFile', 'categoryImageURL', 'categoryImagePreview');
}

function syncCategoriesFromItems() {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    if (!confirm(S.syncCategoriesConfirm || 'Create editable category entries from the categories used by your menu items?')) return;

    db.collection('menuItems').get().then(function (itemSnap) {
        var names = {};
        itemSnap.forEach(function (d) {
            var c = (d.data() || {}).category;
            if (c && c !== 'Water') names[c] = true;
        });
        return db.collection('categories').get().then(function (catSnap) {
            var have = {};
            catSnap.forEach(function (d) { have[d.id] = true; });

            var batch = db.batch();
            var count = 0;
            Object.keys(names).forEach(function (name) {
                if (have[name]) return;
                // Use the name as the document id so existing items (which
                // reference the category by this value) keep matching.
                var ref = db.collection('categories').doc(name);
                batch.set(ref, {
                    name_ku: name, name_ar: name, name_en: name,
                    image: '',
                    created_at: firebase.firestore.FieldValue.serverTimestamp(),
                    updated_at: firebase.firestore.FieldValue.serverTimestamp()
                });
                count++;
            });

            if (count === 0) { alert(S.noNewCategories || 'All categories are already added.'); return; }
            applyWrite(batch.commit(), function () {
                loadCategoriesList();
                alert((S.categoriesSynced || 'Categories added:') + ' ' + count);
            });
        });
    }).catch(function (e) { alert(S.errorPrefix + e.message); });
}

function saveCategory() {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var nameKu = document.getElementById('categoryNameKu').value.trim();
    var nameAr = document.getElementById('categoryNameAr').value.trim();
    var nameEn = document.getElementById('categoryNameEn').value.trim();

    if (!nameKu || !nameAr || !nameEn) {
        alert(S.fillAll);
        return;
    }

    var imgUrl = document.getElementById('categoryImageURL').value.trim();
    var placeholderImg = 'data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27400%27 height=%27300%27%3E%3Crect fill=%23e0e0e0 width=%27400%27 height=%27300%27/%3E%3Ctext x=%2750%25%27 y=%2750%25%27 font-size=%2724%27 text-anchor=%27middle%27 dy=%27.3em%27 fill=%23999%27%3ENo+Image%3C/text%3E%3C/svg%3E';
    var finalImg = imgUrl || placeholderImg;

    var categoryId = document.getElementById('categoryId').value;
    var categoryData = {
        name_ku: nameKu,
        name_ar: nameAr,
        name_en: nameEn,
        image: finalImg,
        updated_at: firebase.firestore.FieldValue.serverTimestamp()
    };

    var promise;
    var savedId = categoryId;
    if (categoryId) {
        promise = db.collection('categories').doc(categoryId).set(categoryData, { merge: true });
    } else {
        categoryData.created_at = firebase.firestore.FieldValue.serverTimestamp();
        var newRef = db.collection('categories').doc();
        savedId = newRef.id;
        promise = newRef.set(categoryData);
    }

    applyWrite(promise, function () {
        upsertCachedCategory(savedId, categoryData);
        document.getElementById('categoryModal').classList.remove('active');
        renderCategoriesListNow();
        loadCategoriesDropdown();
        alert(S.categorySaved);
    });
}

function openCategoryModalWith(categoryId, cat, isNew) {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    document.getElementById('categoryForm').reset();
    document.getElementById('categoryId').value = categoryId;
    document.getElementById('categoryNameKu').value = cat.name_ku || '';
    document.getElementById('categoryNameAr').value = cat.name_ar || '';
    document.getElementById('categoryNameEn').value = cat.name_en || '';
    var pr = document.getElementById('categoryImagePreview');
    if (cat.image) {
        document.getElementById('categoryImageURL').value = cat.image;
        if (pr) { pr.src = cat.image; pr.style.display = 'block'; }
    } else if (pr) {
        pr.style.display = 'none';
    }
    document.getElementById('categoryModalTitle').textContent = isNew ? S.addCategory : S.editCategory;
    document.getElementById('categoryModal').classList.add('active');
}

function editCategory(categoryId) {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    db.collection('categories').doc(categoryId).get().then(function (doc) {
        if (!doc.exists) {
            // A menu-derived (virtual) category: prefill from its name so saving
            // creates a real, editable category document with this id.
            openCategoryModalWith(categoryId, { name_ku: categoryId, name_ar: categoryId, name_en: categoryId, image: '' }, true);
            return;
        }
        openCategoryModalWith(categoryId, doc.data(), false);
    }).catch(function (e) {
        // Offline / no server: still allow editing using the id as a starting point.
        openCategoryModalWith(categoryId, { name_ku: categoryId, name_ar: categoryId, name_en: categoryId, image: '' }, true);
    });
}

function deleteCategory(categoryId) {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    if (!confirm(S.deleteCategoryConfirm)) return;
    
    // First, delete all items in this category
    db.collection('menuItems').where('category', '==', categoryId).get().then(function (snap) {
        var batch = db.batch();
        snap.forEach(function (doc) {
            batch.delete(doc.ref);
        });
        
        // Delete the category
        batch.delete(db.collection('categories').doc(categoryId));

        applyWrite(batch.commit(), function () { loadCategoriesList(); });
    }).catch(function (e) { alert(S.errorPrefix + e.message); });
}

/* ============ CASHIER ============ */

function stopCashierListener() {
    if (cashierUnsubscribe) {
        cashierUnsubscribe();
        cashierUnsubscribe = null;
    }
}

function invalidateCashierCache() {
    localStorage.removeItem('cachedCashierItems');
}

function normalizeCashierItemEntry(it) {
    if (!it) return null;
    if (it.v) {
        if (it.v.available === false || it.v.category === 'Water') return null;
        return it;
    }
    var id = it.id;
    if (!id) return null;
    var v = Object.assign({}, it);
    delete v.id;
    if (v.available === false || v.category === 'Water') return null;
    return { id: id, v: v };
}

function getCashierItemsFromLocalStorage() {
    var keys = ['cachedCashierItems', 'cachedMenuItems'];
    for (var i = 0; i < keys.length; i++) {
        var raw = localStorage.getItem(keys[i]);
        if (!raw) continue;
        try {
            var parsed = JSON.parse(raw);
            if (!Array.isArray(parsed) || parsed.length === 0) continue;
            var items = parsed.map(normalizeCashierItemEntry).filter(Boolean);
            if (items.length > 0) return items;
        } catch (e) {}
    }
    return [];
}

function showCashierEmptyState() {
    var grid = document.getElementById('cashierGrid');
    var catBar = document.getElementById('cashierCatBar');
    var S2 = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    if (catBar) {
        catBar.innerHTML = '<button class="cashier-cat-btn active" data-cat="all"><span class="cashier-cat-label">' + S2.allCategories + '</span></button>';
    }
    if (grid) grid.innerHTML = '<div class="cashier-empty">' + S2.noCategoryItems + '</div>';
}

function normalizeCashierItems(snapshot) {
    var items = [];
    snapshot.forEach(function (d) {
        var data = d.data();
        if (data.available === false) return;
        if (data.category === 'Water') return;
        items.push({ id: d.id, v: data });
    });
    return items;
}

function getCashierCategoryIcons() {
    return {
        'Coffee': '<img class="cashier-cat-icon" src="https://cdn-icons-png.flaticon.com/128/924/924514.png" alt="Coffee">',
        'Tea': '<img class="cashier-cat-icon" src="https://cdn-icons-png.flaticon.com/128/1223/1223749.png" alt="Tea">',
        'Cold Drinks': '<img class="cashier-cat-icon" src="https://cdn-icons-png.flaticon.com/128/1113/1113278.png" alt="Cold Drinks">',
        'Dessert': '<img class="cashier-cat-icon" src="https://cdn-icons-png.flaticon.com/128/8346/8346809.png" alt="Dessert">',
        'Shisha': '<img class="cashier-cat-icon" src="https://cdn-icons-png.flaticon.com/128/10170/10170651.png" alt="Shisha">',
        'Special Drinks': '<img class="cashier-cat-icon" src="https://cdn-icons-png.flaticon.com/128/5473/5473500.png" alt="Special Drinks">'
    };
}

function renderCashierProducts(items) {
    var grid = document.getElementById('cashierGrid');
    var catBar = document.getElementById('cashierCatBar');
    if (!grid || !catBar) return;

    if (!items || items.length === 0) {
        showCashierEmptyState();
        return;
    }

    var lang = localStorage.getItem('selectedLang') || 'ku';
    var S2 = i18n[lang] || i18n.en;
    var catOrder = ['Coffee', 'Tea', 'Cold Drinks', 'Dessert', 'Shisha', 'Special Drinks'];
    var grouped = {};
    items.forEach(function (it) {
        var c = it.v.category || 'Other';
        if (!grouped[c]) grouped[c] = [];
        grouped[c].push(it);
    });
    var ordered = catOrder.filter(function (c) { return grouped[c]; });
    Object.keys(grouped).forEach(function (c) { if (ordered.indexOf(c) === -1) ordered.push(c); });

    var catMap2 = { Coffee: S2.coffee, Tea: S2.tea, 'Cold Drinks': S2.coldDrinks, Dessert: S2.dessert, Shisha: S2.shisha, 'Special Drinks': S2.specialDrinks };
    var categoryIcons = getCashierCategoryIcons();
    var catNameMap = buildCategoryMapFromCache();

    // Prefer the category's own (often uploaded => offline-safe) image.
    var catImageMap = {};
    readCachedCategories().forEach(function (c) {
        if (c && c.data && c.data.image) { catImageMap[c.id] = c.data.image; }
    });
    var fallbackSvg = '<svg class="cashier-cat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/></svg>';

    var catHtml = '<button class="cashier-cat-btn' + (cashierActiveFilter === 'all' ? ' active' : '') + '" data-cat="all"><span class="cashier-cat-label">' + S2.allCategories + '</span></button>';
    ordered.forEach(function (c) {
        var customImg = catImageMap[c];
        var icon = customImg
            ? '<img class="cashier-cat-icon" src="' + customImg + '" alt="" onerror="this.style.display=\'none\'">'
            : (categoryIcons[c] || fallbackSvg);
        var label = getCategoryLabel(c, lang, catNameMap);
        if (label === c && catMap2[c]) label = catMap2[c];
        catHtml += '<button class="cashier-cat-btn' + (cashierActiveFilter === c ? ' active' : '') + '" data-cat="' + c + '">' + icon + '<span class="cashier-cat-label">' + label + '</span></button>';
    });
    catBar.innerHTML = catHtml;

    function renderGrid(filterCat) {
        cashierActiveFilter = filterCat;
        var filtered = filterCat === 'all' ? items : items.filter(function (it) { return it.v.category === filterCat; });
        if (filtered.length === 0) {
            grid.innerHTML = '<div class="cashier-empty">' + S2.noCategoryItems + '</div>';
            return;
        }
        var html = '';
        filtered.forEach(function (it) {
            var name = it.v['name_' + lang] || it.v.name_ku || it.v.name_ar || it.v.name_en || S2.unnamed;
            var price = it.v.price || 0;
            var img = it.v.image || '';
            html += '<div class="cashier-item-card" data-id="' + it.id + '" data-name="' + name + '" data-price="' + price + '">' +
                '<div class="cashier-item-img-wrap">' + (img ? '<img src="' + img + '" alt="' + name + '" loading="lazy" onerror="this.parentElement.innerHTML=\'<div class=cashier-item-noimg>☕</div>\'">' : '<div class="cashier-item-noimg">☕</div>') + '</div>' +
                '<div class="cashier-item-info"><div class="cashier-item-name">' + name + '</div><div class="cashier-item-price">' + price.toLocaleString() + ' <span>IQD</span></div></div>' +
                '<div class="cashier-item-add">+</div>' +
            '</div>';
        });
        grid.innerHTML = html;
        grid.querySelectorAll('.cashier-item-card').forEach(function (card) {
            card.addEventListener('click', function () {
                addToOrder(this.getAttribute('data-id'), this.getAttribute('data-name'), parseFloat(this.getAttribute('data-price')));
            });
        });
    }

    renderGrid(cashierActiveFilter);

    catBar.querySelectorAll('.cashier-cat-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            catBar.querySelectorAll('.cashier-cat-btn').forEach(function (b) { b.classList.remove('active'); });
            this.classList.add('active');
            renderGrid(this.getAttribute('data-cat'));
        });
    });
}

function loadCashier() {
    stopCashierListener();
    orderItems.length = 0;
    cashierActiveFilter = 'all';
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var adminContent = document.getElementById('adminContent');
    var orderCountBadge = '<span class="cashier-order-count" id="cashierOrderCount">0</span>';
    adminContent.innerHTML =
        '<div class="cashier-layout">' +
            '<aside class="cashier-order" id="cashierOrderPanel">' +
                '<div class="cashier-order-header">' +
                    '<h3>' + S.currentOrder + orderCountBadge + '</h3>' +
                    '<div class="cashier-order-header-actions">' +
                        '<button class="btn-clear-order" id="clearOrderBtn">' + S.clear + '</button>' +
                        '<button class="cashier-order-toggle" id="cashierOrderToggle" aria-label="Toggle order">▲</button>' +
                    '</div>' +
                '</div>' +
                '<div class="cashier-order-items" id="cashierOrderItems">' +
                    '<div class="cashier-empty">' + S.noItemsAdded + '</div>' +
                '</div>' +
                '<div class="cashier-order-footer">' +
                    '<div class="cashier-total-row"><span>' + S.total + '</span><span class="cashier-total-amount" id="cashierTotal">0 IQD</span></div>' +
                    '<div class="cashier-actions">' +
                        '<button class="btn-print" id="printBtn">🖨️ ' + S.printReceipt + '</button>' +
                        '<button class="btn-pay" id="payBtn">' + S.payNow + '</button>' +
                    '</div>' +
                '</div>' +
            '</aside>' +
            '<section class="cashier-products">' +
                '<div class="cashier-categories" id="cashierCatBar"></div>' +
                '<div class="cashier-grid" id="cashierGrid"><div class="loading">Loading...</div></div>' +
            '</section>' +
        '</div>';

    loadCashierItems();
    wireCashierEvents();
    wireCashierOrderToggle();
}

function wireCashierOrderToggle() {
    var toggle = document.getElementById('cashierOrderToggle');
    var panel = document.getElementById('cashierOrderPanel');
    if (!toggle || !panel) return;
    var collapsed = false;
    toggle.addEventListener('click', function () {
        collapsed = !collapsed;
        panel.classList.toggle('collapsed', collapsed);
        toggle.textContent = collapsed ? '▼' : '▲';
    });
    if (window.innerWidth <= 768) {
        collapsed = true;
        panel.classList.add('collapsed');
        toggle.textContent = '▼';
    }
}

function loadCashierItems() {
    var grid = document.getElementById('cashierGrid');
    var cachedItems = getCashierItemsFromLocalStorage();

    if (cachedItems.length > 0) {
        renderCashierProducts(cachedItems);
    } else if (grid) {
        grid.innerHTML = '<div class="loading">Loading...</div>';
    }

    if (!window.db) {
        if (cachedItems.length === 0) showCashierEmptyState();
        return;
    }

    stopCashierListener();

    adminGetWithTimeout(db.collection('menuItems'), 8000).then(function (snap) {
        var items = normalizeCashierItems(snap);
        localStorage.setItem('cachedCashierItems', JSON.stringify(items));
        refreshCategoriesCache(function () {
            if (items.length > 0) {
                renderCashierProducts(items);
            } else {
                showCashierEmptyState();
            }
        });
    }).catch(function (e) {
        console.warn('[cashier] get failed:', e.message);
        loadCashierItemsFromCache();
    });

    cashierUnsubscribe = db.collection('menuItems').onSnapshot(function (snap) {
        var items = normalizeCashierItems(snap);
        localStorage.setItem('cachedCashierItems', JSON.stringify(items));
        refreshCategoriesCache(function () {
            if (items.length > 0) {
                renderCashierProducts(items);
            } else {
                showCashierEmptyState();
            }
        });
    }, function (e) {
        console.error('Error loading cashier items:', e);
        loadCashierItemsFromCache();
    });
}

function loadCashierItemsFromCache() {
    var items = getCashierItemsFromLocalStorage();
    if (items.length === 0) {
        showCashierEmptyState();
        return;
    }
    console.log('Loaded cashier items from cache:', items.length);
    renderCashierProducts(items);
}

function wireCashierEvents() {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var payBtn = document.getElementById('payBtn');
    if (payBtn) {
        payBtn.addEventListener('click', function () {
            if (orderItems.length === 0) { alert(S.addFirst); return; }
            var total = recordCashierSale(orderItems.slice());
            if (total === null) return;
            alert(S.paymentSuccess + total.toLocaleString() + ' IQD');
        });
    }

    var clearBtn = document.getElementById('clearOrderBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', function () {
            if (orderItems.length === 0) return;
            orderItems.length = 0;
            updateOrderDisplay();
        });
    }

    var printBtn = document.getElementById('printBtn');
    if (printBtn) {
        printBtn.addEventListener('click', function () {
            if (orderItems.length === 0) { alert(S.addFirst); return; }
            var itemsCopy = orderItems.slice();
            printReceipt(itemsCopy);
            recordCashierSale(itemsCopy);
        });
    }
}

function recordCashierSale(items) {
    if (!items || items.length === 0) return null;
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var total = items.reduce(function (s, i) { return s + i.price * i.quantity; }, 0);
    var now = new Date();
    var tempId = 'local-' + Date.now();
    var cacheEntry = {
        id: tempId,
        items: items.map(function (i) { return { name: i.name, price: i.price, quantity: i.quantity }; }),
        total: total,
        timestampSeconds: Math.floor(now.getTime() / 1000),
        cashier: (window.auth && auth.currentUser) ? auth.currentUser.email : S.unknown
    };
    upsertCachedSale(cacheEntry);

    var saleWrite = db.collection('sales').add({
        items: cacheEntry.items,
        total: total,
        timestamp: firebase.firestore.Timestamp.fromDate(now),
        created_at: firebase.firestore.FieldValue.serverTimestamp(),
        cashier: cacheEntry.cashier
    });
    applyWrite(saleWrite, function () {
        orderItems.length = 0;
        updateOrderDisplay();
    });
    if (saleWrite && typeof saleWrite.then === 'function') {
        saleWrite.then(function (ref) {
            if (ref && ref.id) {
                removeCachedSale(tempId);
                upsertCachedSale(Object.assign({}, cacheEntry, { id: ref.id }));
            }
        }).catch(function (err) {
            console.error('Sale sync error (will retry when online):', err);
        });
    }
    return total;
}

function addToOrder(id, name, price) {
    var existing = orderItems.find(function (i) { return i.id === id; });
    if (existing) { existing.quantity += 1; }
    else { orderItems.push({ id: id, name: name, price: price, quantity: 1 }); }
    updateOrderDisplay();
}

function escapeReceiptHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatReceiptPhone(raw) {
    var digits = String(raw || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.indexOf('964') === 0) {
        return '+964 ' + digits.slice(3, 6) + ' ' + digits.slice(6, 9) + ' ' + digits.slice(9);
    }
    return '+' + digits;
}

var RECEIPT_PRINT_WIDTH_PX = 240; /* XP-80 — safe width, left-aligned */

function buildReceiptPrintHtml(options) {
    var itemsHtml = '';
    var itemCount = 0;
    var w = RECEIPT_PRINT_WIDTH_PX;
    var lang = options.lang || 'ku';
    var langClass = 'lang-' + (lang === 'ar' || lang === 'en' ? lang : 'ku');
    var LRM = '\u200E';

    options.items.forEach(function (item, idx) {
        itemCount += item.quantity;
        var subtotal = item.price * item.quantity;
        var calcLine = LRM + item.quantity + ' × ' + item.price.toLocaleString() + ' = ' + subtotal.toLocaleString();

        itemsHtml +=
            '<div class="item">' +
                '<div class="item-top">' +
                    '<span class="item-name">' + escapeReceiptHtml(item.name) + '</span>' +
                    '<span class="item-amt">' + subtotal.toLocaleString() + '</span>' +
                '</div>' +
                '<div class="item-calc">' + escapeReceiptHtml(calcLine) + ' IQD</div>' +
            '</div>';
        if (idx < options.items.length - 1) {
            itemsHtml += '<hr class="item-line">';
        }
    });

    return '<!DOCTYPE html>' +
    '<html lang="' + escapeReceiptHtml(options.lang) + '" dir="ltr">' +
    '<head>' +
        '<meta charset="UTF-8">' +
        '<title>Receipt</title>' +
        '<style>' +
            '@page { margin: 0; size: auto; }' +
            '* { box-sizing: border-box; margin: 0; padding: 0; }' +
            'html { width: ' + w + 'px; max-width: ' + w + 'px; }' +
            'body {' +
                'width: ' + w + 'px; max-width: ' + w + 'px;' +
                'margin: 0; padding: 4px 14px 8px 4px;' +
                'font-family: Tahoma, Arial, sans-serif;' +
                'font-size: 10px; line-height: 1.28; color: #000; background: #fff;' +
                'direction: ltr; text-align: left;' +
                '-webkit-print-color-adjust: exact; print-color-adjust: exact;' +
            '}' +
            '.receipt { width: 100%; max-width: 100%; overflow: hidden; }' +
            '.brand-logo { display: block; width: 28px; height: 28px; margin: 0 auto 3px; border-radius: 50%; object-fit: cover; }' +
            '.rule { border: none; border-top: 1px dashed #000; margin: 4px 0; width: 100%; }' +
            '.rule-solid { border: none; border-top: 1px solid #000; margin: 4px 0; width: 100%; }' +
            '.brand-title { font-family: Georgia, "Times New Roman", serif; font-size: 11px; font-weight: 700; text-align: center; line-height: 1.2; margin-bottom: 1px; }' +
            '.brand-title .en { direction: ltr; unicode-bidi: embed; }' +
            '.brand-title .sep { opacity: 0.4; padding: 0 2px; }' +
            '.brand-title .ku { font-weight: 700; direction: rtl; unicode-bidi: embed; }' +
            '.brand-tagline { text-align: center; font-size: 7px; letter-spacing: 0.1em; text-transform: uppercase; color: #444; }' +
            '.brand-location { text-align: center; font-size: 9px; color: #222; margin-top: 1px; direction: rtl; unicode-bidi: plaintext; }' +
            '.meta-receipt { text-align: center; font-size: 9px; font-weight: 700; margin-bottom: 3px; }' +
            '.meta-datetime { width: 100%; margin: 2px 0; }' +
            '.meta-date, .meta-time { font-size: 9px; font-weight: 600; direction: ltr; unicode-bidi: embed; text-align: center; line-height: 1.35; }' +
            '.meta-pieces { text-align: center; font-size: 8px; color: #333; margin-top: 2px; }' +
            'body.lang-ku .meta-receipt, body.lang-ku .meta-pieces, body.lang-ku .thanks-main, body.lang-ku .brand-location { direction: rtl; unicode-bidi: plaintext; }' +
            'body.lang-ar .meta-receipt, body.lang-ar .meta-pieces, body.lang-ar .thanks-main, body.lang-ar .brand-location { direction: rtl; unicode-bidi: plaintext; }' +
            '.items-wrap { margin: 2px 0; width: 100%; max-width: 100%; }' +
            '.item { padding: 3px 0; width: 100%; max-width: 100%; }' +
            '.item-top { display: flex; flex-direction: row; justify-content: space-between; align-items: flex-start; width: 100%; max-width: 100%; gap: 4px; }' +
            '.item-name { flex: 1 1 auto; min-width: 0; font-weight: 700; font-size: 10px; word-wrap: break-word; overflow-wrap: break-word; }' +
            '.item-amt { flex: 0 0 auto; max-width: 42%; font-weight: 700; font-size: 10px; direction: ltr; unicode-bidi: embed; white-space: nowrap; }' +
            'body.lang-ku .item-top, body.lang-ar .item-top { flex-direction: row-reverse; }' +
            'body.lang-ku .item-name, body.lang-ar .item-name { text-align: right; direction: rtl; unicode-bidi: plaintext; }' +
            'body.lang-ku .item-amt, body.lang-ar .item-amt { text-align: left; }' +
            'body.lang-en .item-name { text-align: left; direction: ltr; }' +
            'body.lang-en .item-amt { text-align: right; }' +
            '.item-calc { text-align: center; width: 100%; max-width: 100%; font-size: 8px; color: #333; margin-top: 2px; direction: ltr; unicode-bidi: embed; overflow: hidden; }' +
            '.item-line { border: none; border-top: 1px dashed #000; margin: 0; height: 0; width: 100%; }' +
            '.total-box { border: 1.5px solid #000; border-radius: 4px; padding: 4px 5px; margin: 4px 0 3px; display: flex; flex-direction: row; justify-content: space-between; align-items: center; width: 100%; max-width: 100%; gap: 4px; }' +
            'body.lang-ku .total-box, body.lang-ar .total-box { flex-direction: row-reverse; }' +
            '.total-label { flex: 1 1 auto; min-width: 0; font-size: 9px; font-weight: 700; text-transform: uppercase; }' +
            '.total-value { flex: 0 0 auto; font-size: 11px; font-weight: 700; direction: ltr; unicode-bidi: embed; white-space: nowrap; max-width: 55%; }' +
            'body.lang-ku .total-label, body.lang-ar .total-label { text-align: right; direction: rtl; unicode-bidi: plaintext; }' +
            'body.lang-en .total-label { text-align: left; direction: ltr; }' +
            'body.lang-ku .total-value, body.lang-ar .total-value { text-align: left; }' +
            'body.lang-en .total-value { text-align: right; }' +
            '.total-currency { font-size: 7px; font-weight: 600; margin-left: 2px; }' +
            '.footer-thanks { text-align: center; margin-top: 4px; padding-top: 3px; border-top: 1px dashed #000; width: 100%; }' +
            '.thanks-main { font-size: 10px; font-weight: 700; margin-bottom: 1px; }' +
            '.thanks-sub { font-size: 7px; color: #444; text-align: center; }' +
            '.footer-contact { text-align: center; margin-top: 3px; font-size: 9px; width: 100%; }' +
            '.footer-contact .phone { font-weight: 700; direction: ltr; unicode-bidi: embed; }' +
            '@media print {' +
                'html, body { width: ' + w + 'px !important; max-width: ' + w + 'px !important; margin: 0 !important; padding: 2px 14px 6px 4px !important; }' +
                '@page { margin: 0; size: auto; }' +
            '}' +
        '</style>' +
    '</head>' +
    '<body class="' + langClass + '">' +
        '<div class="receipt">' +
            '<img class="brand-logo" src="' + escapeReceiptHtml(options.logoUrl || 'assets/icon-192.png') + '" alt="" onerror="this.style.display=\'none\'">' +
            '<div class="brand-title"><span class="en">Ali Coffee</span><span class="sep">|</span><span class="ku">عەلی كافێ</span></div>' +
            '<div class="brand-tagline">Premium Coffee House</div>' +
            (options.location ? '<div class="brand-location">' + escapeReceiptHtml(options.location) + '</div>' : '') +
            '<hr class="rule">' +
            '<div class="meta-receipt">' + escapeReceiptHtml(options.labels.receipt) + ' #' + escapeReceiptHtml(options.receiptNo) + '</div>' +
            '<div class="meta-datetime">' +
                '<div class="meta-date">' + escapeReceiptHtml(options.labels.date) + ': ' + escapeReceiptHtml(options.dateStr) + '</div>' +
                '<div class="meta-time">' + escapeReceiptHtml(options.labels.time) + ': ' + escapeReceiptHtml(options.timeStr) + '</div>' +
            '</div>' +
            '<div class="meta-pieces">' + itemCount + ' ' + escapeReceiptHtml(options.labels.pieces) + '</div>' +
            '<hr class="rule-solid">' +
            '<div class="items-wrap">' + itemsHtml + '</div>' +
            '<hr class="rule">' +
            '<div class="total-box">' +
                '<span class="total-label">' + escapeReceiptHtml(options.labels.total) + '</span>' +
                '<span class="total-value">' + options.total.toLocaleString() + '<span class="total-currency">IQD</span></span>' +
            '</div>' +
            '<div class="footer-thanks">' +
                '<div class="thanks-main">' + escapeReceiptHtml(options.labels.thanksMain) + '</div>' +
                '<div class="thanks-sub">' + escapeReceiptHtml(options.labels.thanksSub) + '</div>' +
            '</div>' +
            (options.phone ? '<div class="footer-contact"><div class="phone">' + escapeReceiptHtml(options.phone) + '</div></div>' : '') +
        '</div>' +
    '</body></html>';
}

function printHtmlInFrame(html) {
    var w = RECEIPT_PRINT_WIDTH_PX + 'px';
    var frame = document.getElementById('receiptPrintFrame');
    if (!frame) {
        frame = document.createElement('iframe');
        frame.id = 'receiptPrintFrame';
        frame.title = 'Receipt print';
        frame.setAttribute('aria-hidden', 'true');
        document.body.appendChild(frame);
    }

    frame.style.cssText =
        'position:fixed;left:-9999px;top:0;width:' + w + ';min-width:' + w + ';max-width:' + w +
        ';height:800px;border:0;visibility:hidden;overflow:hidden;background:#fff';

    var win = frame.contentWindow;
    if (!win) {
        alert('Print failed. Please use Chrome or Edge.');
        return false;
    }

    var doc = win.document;
    doc.open();
    doc.write(html);
    doc.close();

    function runPrint() {
        try {
            win.focus();
            win.print();
        } catch (err) {
            console.error('Print error:', err);
            alert('Print failed. Please try again.');
        }
    }

    if (doc.fonts && doc.fonts.ready) {
        doc.fonts.ready.then(function () {
            setTimeout(runPrint, 150);
        }).catch(function () {
            setTimeout(runPrint, 200);
        });
    } else {
        setTimeout(runPrint, 250);
    }

    return true;
}

function printReceipt(itemsOverride) {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var lang = localStorage.getItem('selectedLang') || 'ku';
    var items = itemsOverride || orderItems;
    if (items.length === 0) {
        alert(S.addFirst || 'Add items first');
        return;
    }

    var now = new Date();
    var receiptLabels = {
        ku: {
            receipt: 'پسوڵە',
            date: 'بەروار',
            time: 'کات',
            pieces: 'دانە',
            total: 'کۆی گشتی',
            thanksMain: 'سوپاس بۆ سەردانتان!',
            thanksSub: 'Thank you · شكراً لزيارتكم'
        },
        ar: {
            receipt: 'فاتورة',
            date: 'التاريخ',
            time: 'الوقت',
            pieces: 'قطعة',
            total: 'الإجمالي',
            thanksMain: 'شكراً لزيارتكم!',
            thanksSub: 'Thank you · سوپاس بۆ سەردانتان'
        },
        en: {
            receipt: 'Receipt',
            date: 'Date',
            time: 'Time',
            pieces: 'pcs',
            total: 'Total',
            thanksMain: 'Thank you for visiting!',
            thanksSub: 'سوپاس · شكراً لزيارتكم'
        }
    };

    var labels = receiptLabels[lang] || receiptLabels.ku;
    var total = items.reduce(function (s, i) { return s + i.price * i.quantity; }, 0);
    var receiptNo = String(now.getTime()).slice(-6);
    var phone = formatReceiptPhone(localStorage.getItem('whatsappPhone') || '9647506454656');
    var location = localStorage.getItem('cafeLocationLabel') || 'بەحرکە-مجەمع';

    var logoUrl = new URL('assets/icon-192.png', window.location.href).href;

    var receiptHTML = buildReceiptPrintHtml({
        lang: lang,
        items: items.slice(),
        total: total,
        receiptNo: receiptNo,
        dateStr: now.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }),
        timeStr: now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
        phone: phone,
        location: location,
        logoUrl: logoUrl,
        labels: labels
    });

    printHtmlInFrame(receiptHTML);
}

function setupAdminOfflineDetection() {
    window.addEventListener('online', function () {
        console.log('Admin: Back online — syncing data');
        showAdminConnectionStatus(true);
        warmAdminOfflineCache(function () {
            refreshAdminCurrentSection();
        });
    });

    window.addEventListener('offline', function () {
        console.log('Admin: Gone offline');
        showAdminConnectionStatus(false);
    });

    // Show the offline badge immediately if we start offline.
    if (!navigator.onLine) showAdminConnectionStatus(false);
}

var _adminOnlineHideTimer = null;

function showAdminConnectionStatus(online) {
    var existing = document.getElementById('adminOfflineIndicator');
    if (existing) existing.remove();
    if (_adminOnlineHideTimer) { clearTimeout(_adminOnlineHideTimer); _adminOnlineHideTimer = null; }

    var lang = localStorage.getItem('selectedLang') || 'ku';
    var S = i18n[lang] || i18n.en;

    var indicator = document.createElement('div');
    indicator.id = 'adminOfflineIndicator';
    indicator.style.cssText = 'position:fixed;top:70px;right:20px;color:#fff;padding:8px 16px;border-radius:20px;font-size:12px;font-weight:600;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.3);display:flex;align-items:center;gap:8px;transition:opacity .4s ease;';

    var dot = document.createElement('span');
    dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#fff;display:inline-block;';
    indicator.appendChild(dot);

    var label = document.createElement('span');

    if (online) {
        indicator.style.background = '#2E7D32';
        label.textContent = (S.backOnline || 'Back online — syncing');
        indicator.appendChild(label);
        document.body.appendChild(indicator);
        // Auto-hide the green confirmation after a few seconds.
        _adminOnlineHideTimer = setTimeout(function () {
            indicator.style.opacity = '0';
            setTimeout(function () { if (indicator.parentNode) indicator.remove(); }, 400);
        }, 3000);
    } else {
        indicator.style.background = '#C62828';
        label.textContent = (S.offlineMode || 'Offline Mode — changes will sync');
        indicator.appendChild(label);
        document.body.appendChild(indicator);
    }
}

function populateTestData() {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    
    if (!confirm('This will add sample menu items for each category. Continue?')) return;
    
    db.collection('categories').get().then(function (snap) {
        if (snap.empty) {
            alert('No categories found. Please create categories first.');
            return;
        }
        
        var categories = [];
        snap.forEach(function (doc) {
            categories.push({ id: doc.id, data: doc.data() });
        });
        
        var sampleItems = [
            {
                name_ku: 'قاوەی تایبەت',
                name_ar: 'قهوة خاصة',
                name_en: 'Special Coffee',
                desc_ku: 'قاوەی تایبەت بە تامێکی جوان',
                desc_ar: 'قهوة خاصة بطعم جميل',
                desc_en: 'Special coffee with beautiful taste',
                price: 2500,
                image: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=400'
            },
            {
                name_ku: 'چای سەوز',
                name_ar: 'شاي أخضر',
                name_en: 'Green Tea',
                desc_ku: 'چای سەوزی تازە',
                desc_ar: 'شاي أخضر طازج',
                desc_en: 'Fresh green tea',
                price: 1500,
                image: 'https://images.unsplash.com/photo-1556881286-fc6915169721?w=400'
            },
            {
                name_ku: 'جوسەی پرتەقاڵ',
                name_ar: 'عصير برتقال',
                name_en: 'Orange Juice',
                desc_ku: 'جوسەی پرتەقاڵی تازە',
                desc_ar: 'عصير برتقال طازج',
                desc_en: 'Fresh orange juice',
                price: 3000,
                image: 'https://images.unsplash.com/photo-1613478223719-2ab802602423?w=400'
            },
            {
                name_ku: 'کێک',
                name_ar: 'كيك',
                name_en: 'Cake',
                desc_ku: 'کێکی شیرین',
                desc_ar: 'كيك حلو',
                desc_en: 'Sweet cake',
                price: 4000,
                image: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400'
            }
        ];
        
        var addedCount = 0;
        var promises = [];
        
        categories.forEach(function (cat, index) {
            var sample = sampleItems[index % sampleItems.length];
            var item = {
                name_ku: sample.name_ku,
                name_ar: sample.name_ar,
                name_en: sample.name_en,
                description_ku: sample.desc_ku,
                description_ar: sample.desc_ar,
                description_en: sample.desc_en,
                price: sample.price,
                image: sample.image,
                category: cat.id,
                available: true
            };
            
            var promise = db.collection('menuItems').add(item).then(function () {
                addedCount++;
                console.log('Added item for category:', cat.data.name_en);
            }).catch(function (e) {
                console.error('Error adding item:', e);
            });
            
            promises.push(promise);
        });
        
        Promise.all(promises).then(function () {
            alert('Added ' + addedCount + ' sample items successfully!');
            loadItemsList();
        }).catch(function (e) {
            alert('Error: ' + e.message);
        });
    }).catch(function (e) {
        alert('Error loading categories: ' + e.message);
    });
}

function updateOrderDisplay() {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var container = document.getElementById('cashierOrderItems');
    var totalEl = document.getElementById('cashierTotal');
    var countEl = document.getElementById('cashierOrderCount');
    if (!container) return;

    var totalQty = 0;
    if (countEl) {
        orderItems.forEach(function (i) { totalQty += i.quantity; });
        countEl.textContent = totalQty;
        countEl.style.display = totalQty > 0 ? '' : 'none';
    }

    if (orderItems.length === 0) {
        container.innerHTML = '<div class="cashier-empty">' + S.noItemsAdded + '</div>';
        if (totalEl) totalEl.textContent = '0 IQD';
        return;
    }

    var html = '';
    var total = 0;
    orderItems.forEach(function (item, idx) {
        var sub = item.price * item.quantity;
        total += sub;
        html += '<div class="cashier-order-item">' +
            '<div class="cashier-order-item-name">' + item.name + '</div>' +
            '<div class="cashier-order-item-price">' + item.price.toLocaleString() + ' IQD</div>' +
            '<div class="cashier-qty-control">' +
                '<button class="cashier-qty-btn minus" data-idx="' + idx + '">\u2212</button>' +
                '<span class="cashier-qty-val">' + item.quantity + '</span>' +
                '<button class="cashier-qty-btn plus" data-idx="' + idx + '">+</button>' +
            '</div>' +
            '<div class="cashier-order-item-subtotal">' + sub.toLocaleString() + '</div>' +
            '<button class="cashier-remove-btn" data-idx="' + idx + '">\u2715</button>' +
        '</div>';
    });
    container.innerHTML = html;
    if (totalEl) totalEl.textContent = total.toLocaleString() + ' IQD';

    container.querySelectorAll('.cashier-qty-btn.minus').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var i = parseInt(this.getAttribute('data-idx'));
            orderItems[i].quantity--;
            if (orderItems[i].quantity <= 0) orderItems.splice(i, 1);
            updateOrderDisplay();
        });
    });
    container.querySelectorAll('.cashier-qty-btn.plus').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var i = parseInt(this.getAttribute('data-idx'));
            orderItems[i].quantity++;
            updateOrderDisplay();
        });
    });
    container.querySelectorAll('.cashier-remove-btn').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            orderItems.splice(parseInt(this.getAttribute('data-idx')), 1);
            updateOrderDisplay();
        });
    });
}

/* ============ SETTINGS ============ */

function applyAdminAccent(accent) {
    var allowed = ['gold', 'emerald', 'sapphire', 'amethyst', 'ruby', 'sunset', 'rose', 'graphite', 'cyan'];
    if (allowed.indexOf(accent) === -1) accent = 'gold';
    document.documentElement.setAttribute('data-accent', accent);
    try { localStorage.setItem('adminAccent', accent); } catch (e) {}
    var themeMeta = { gold: '#D4AF37', emerald: '#10B981', sapphire: '#3B82F6', amethyst: '#8B5CF6', ruby: '#F43F5E', sunset: '#F97316', rose: '#EC4899', graphite: '#94A3B8', cyan: '#06B6D4' };
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta && themeMeta[accent]) meta.setAttribute('content', themeMeta[accent]);
}
window.applyAdminAccent = applyAdminAccent;

function loadSettings() {
     var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
      var adminContent = document.getElementById('adminContent');
      var themeLabels = {
          ku: { title: 'ڕووکاری ڕەنگ', hint: 'ڕەنگێک هەڵبژێرە بۆ گۆڕینی ڕووکاری داشبۆرد', gold: 'زێڕین', emerald: 'زمروود', sapphire: 'یاقووتی شین', amethyst: 'بەنەوشەیی', ruby: 'یاقووت', sunset: 'خۆرئاوا', rose: 'گوڵی', graphite: 'خۆڵەمێشی', cyan: 'شینی ئاسمانی' },
          ar: { title: 'سمة الألوان', hint: 'اختر لوناً لتغيير مظهر لوحة التحكم بالكامل', gold: 'ذهبي', emerald: 'زمردي', sapphire: 'أزرق ياقوتي', amethyst: 'بنفسجي', ruby: 'ياقوتي', sunset: 'برتقالي', rose: 'وردي', graphite: 'رمادي', cyan: 'سماوي' },
          en: { title: 'Color Theme', hint: 'Pick a color to restyle the entire dashboard', gold: 'Gold', emerald: 'Emerald', sapphire: 'Sapphire', amethyst: 'Amethyst', ruby: 'Ruby', sunset: 'Sunset', rose: 'Rose', graphite: 'Graphite', cyan: 'Cyan' }
      };
      var TL = themeLabels[localStorage.getItem('selectedLang') || 'ku'] || themeLabels.en;
      var themes = [
          { id: 'gold', color: '#D4AF37', dark: '#B8910C' },
          { id: 'emerald', color: '#10B981', dark: '#047857' },
          { id: 'sapphire', color: '#3B82F6', dark: '#1D4ED8' },
          { id: 'amethyst', color: '#8B5CF6', dark: '#6D28D9' },
          { id: 'ruby', color: '#F43F5E', dark: '#BE123C' },
          { id: 'sunset', color: '#F97316', dark: '#C2410C' },
          { id: 'rose', color: '#EC4899', dark: '#BE185D' },
          { id: 'cyan', color: '#06B6D4', dark: '#0E7490' },
          { id: 'graphite', color: '#94A3B8', dark: '#475569' }
      ];
      var currentAccent = localStorage.getItem('adminAccent') || 'gold';
      var swatchesHtml = themes.map(function (t) {
          var glow = 'rgba(0,0,0,0.25)';
          return '<button type="button" class="theme-swatch' + (t.id === currentAccent ? ' active' : '') + '" data-accent="' + t.id + '" ' +
                 'style="--swatch:' + t.color + ';--swatch-dark:' + t.dark + ';--swatch-glow:' + glow + ';">' +
                 '<span class="theme-swatch-check">✓</span>' +
                 '<span class="theme-swatch-dot"></span>' +
                 '<span class="theme-swatch-name">' + (TL[t.id] || t.id) + '</span>' +
                 '</button>';
      }).join('');

      adminContent.innerHTML =
          '<div class="card">' +
              '<h2>' + S.settings + '</h2>' +
              '<div class="form-group"><label>' + S.cafeName + '</label><input type="text" id="cafeName" value="' + (localStorage.getItem('cafeName') || S.siteName) + '"></div>' +
              '<div class="form-group"><label>' + S.whatsappPhone + '</label><input type="tel" id="whatsappPhone" value="' + (localStorage.getItem('whatsappPhone') || '9647506454656') + '" placeholder="' + S.phonePlaceholder + '"></div>' +
              '<div class="form-group"><label>Location (maps link)</label><input type="url" id="cafeLocationUrl" value="' + (localStorage.getItem('cafeLocationUrl') || 'https://maps.app.goo.gl/mmi5iv7mnGKxKZoq9?g_st=ic') + '" placeholder="https://maps.google.com/..."></div>' +
              '<div class="form-group"><label>Location label</label><input type="text" id="cafeLocationLabel" value="' + (localStorage.getItem('cafeLocationLabel') || 'بەحرکە-مجەمع') + '"></div>' +
              '<div class="form-group"><label>Instagram URL</label><input type="url" id="cafeInstagram" value="' + (localStorage.getItem('cafeInstagram') || '') + '" placeholder="https://instagram.com/..."></div>' +
              '<div class="form-group"><label>' + S.currency + '</label><input type="text" value="IQD" readonly></div>' +
              '<button class="btn-primary" id="saveSettingsBtn">' + S.saveSettings + '</button>' +
          '</div>' +
          '<div class="card" style="margin-top:20px;">' +
              '<div class="settings-section-label">🎨 ' + TL.title + '</div>' +
              '<div class="settings-section-hint">' + TL.hint + '</div>' +
              '<div class="theme-picker" id="themePicker">' + swatchesHtml + '</div>' +
          '</div>' +
          '<div class="card" style="margin-top:20px;border:1px solid #C62828;">' +
              '<h2 style="color:#C62828;">⚠️ ' + S.resetAllData + '</h2>' +
              '<p style="margin-bottom:12px;color:#666;">' + S.resetConfirm + '</p>' +
              '<button class="btn-danger" id="resetAllDataBtn">' + S.resetAllData + '</button>' +
          '</div>';

      var themePicker = document.getElementById('themePicker');
      if (themePicker) {
          themePicker.addEventListener('click', function (e) {
              var btn = e.target.closest('.theme-swatch');
              if (!btn) return;
              var accent = btn.getAttribute('data-accent');
              applyAdminAccent(accent);
              themePicker.querySelectorAll('.theme-swatch').forEach(function (s) {
                  s.classList.toggle('active', s === btn);
              });
          });
      }

      var saveBtn = document.getElementById('saveSettingsBtn');
      if (saveBtn) {
          saveBtn.addEventListener('click', function () {
              var cafeName = document.getElementById('cafeName').value.trim();
              var whatsappPhone = document.getElementById('whatsappPhone').value.trim();
              var cafeLocationUrl = document.getElementById('cafeLocationUrl').value.trim();
              var cafeLocationLabel = document.getElementById('cafeLocationLabel').value.trim();
              var cafeInstagram = document.getElementById('cafeInstagram').value.trim();
              localStorage.setItem('cafeName', cafeName);
              localStorage.setItem('whatsappPhone', whatsappPhone);
              localStorage.setItem('cafeLocationUrl', cafeLocationUrl);
              localStorage.setItem('cafeLocationLabel', cafeLocationLabel);
              localStorage.setItem('cafeInstagram', cafeInstagram);
              alert(S.settingsSaved);
          });
      }

     var resetBtn = document.getElementById('resetAllDataBtn');
     if (resetBtn) {
         resetBtn.addEventListener('click', function () { resetAllData(); });
     }
 }

function resetAllData() {
     var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
     if (!confirm(S.resetConfirm)) return;

     // Reset money/income only — keep menu items and categories intact.
     var collections = ['sales', 'expenses'];
     var promises = [];

     collections.forEach(function (col) {
         var p = db.collection(col).get().then(function (snap) {
             if (snap.empty) return Promise.resolve(0);
             var batches = [];
             var batch = db.batch();
             var count = 0;
             snap.forEach(function (doc) {
                 batch.delete(doc.ref);
                 count++;
                 if (count === 500) {
                     batches.push(batch.commit());
                     batch = db.batch();
                     count = 0;
                 }
             });
             if (count > 0) {
                 batches.push(batch.commit());
             }
             return Promise.all(batches);
         }).catch(function (e) {
             console.error('Error deleting from ' + col + ':', e);
             throw e;
         });
         promises.push(p);
     });

     Promise.all(promises).then(function () {
         alert(S.resetSuccess);
         loadAdminSection('dashboard');
     }).catch(function (e) {
         alert(S.resetError + (e ? e.message : ''));
     });
 }

 /* ============ EXPENSES ============ */

 function readCachedExpenses() {
     try {
         return JSON.parse(localStorage.getItem('cachedExpenses') || '[]');
     } catch (e) {
         return [];
     }
 }

 function writeCachedExpenses(items) {
     localStorage.setItem('cachedExpenses', JSON.stringify(items));
 }

 function expenseTimestampToMs(item) {
     if (!item) return 0;
     if (item.timestampSeconds != null) return item.timestampSeconds * 1000;
     var ts = item.timestamp;
     if (!ts) {
         if (item.date && item.time) {
             var d = new Date(item.date + 'T' + item.time);
             return isNaN(d.getTime()) ? 0 : d.getTime();
         }
         return 0;
     }
     if (typeof ts.toDate === 'function') return ts.toDate().getTime();
     if (ts.seconds != null) return ts.seconds * 1000;
     if (ts._seconds != null) return ts._seconds * 1000;
     var parsed = new Date(ts);
     return isNaN(parsed.getTime()) ? 0 : parsed.getTime();
 }

 function expenseEntryFromDoc(doc) {
     var exp = doc.data();
     var ts = exp.timestamp;
     var timestampSeconds = null;
     if (ts && ts.seconds != null) timestampSeconds = ts.seconds;
     else if (ts && ts._seconds != null) timestampSeconds = ts._seconds;
     else if (ts && typeof ts.toDate === 'function') timestampSeconds = Math.floor(ts.toDate().getTime() / 1000);
     return {
         id: doc.id,
         name: exp.name,
         price: exp.price || 0,
         date: exp.date,
         time: exp.time,
         timestampSeconds: timestampSeconds
     };
 }

 function getExpenseMonthRange(month) {
     var year = new Date().getFullYear();
     return {
         start: new Date(year, month, 1),
         end: new Date(year, month + 1, 1)
     };
 }

 function filterExpensesByMonth(items, month) {
     var range = getExpenseMonthRange(month);
     var startMs = range.start.getTime();
     var endMs = range.end.getTime();
     return items.filter(function (item) {
         var ms = expenseTimestampToMs(item);
         return ms >= startMs && ms < endMs;
     }).sort(function (a, b) {
         return expenseTimestampToMs(b) - expenseTimestampToMs(a);
     });
 }

 function upsertCachedExpense(entry) {
     var items = readCachedExpenses();
     var idx = -1;
     for (var i = 0; i < items.length; i++) {
         if (items[i].id === entry.id) { idx = i; break; }
     }
     if (idx >= 0) items[idx] = entry;
     else items.push(entry);
     writeCachedExpenses(items);
 }

 function removeCachedExpense(id) {
     writeCachedExpenses(readCachedExpenses().filter(function (e) { return e.id !== id; }));
 }

 function mergeExpensesSnapIntoCache(snap) {
     if (!snap || snap.empty) return;
     var all = readCachedExpenses();
     snap.forEach(function (doc) {
         var entry = expenseEntryFromDoc(doc);
         var found = false;
         for (var i = 0; i < all.length; i++) {
             if (all[i].id === entry.id) { all[i] = entry; found = true; break; }
         }
         if (!found) all.push(entry);
     });
     writeCachedExpenses(all);
 }

 function paintExpensesStatsFromCache(month) {
     if (month === undefined || month === null) month = new Date().getMonth();
     var year = new Date().getFullYear();
     var today = new Date();
     today.setHours(0, 0, 0, 0);
     var tomorrow = new Date(today);
     tomorrow.setDate(tomorrow.getDate() + 1);
     var mStart = new Date(year, month, 1);
     var mEnd = new Date(year, month + 1, 1);

     var todayTotal = sumExpensesInRange(today, tomorrow);
     var monthItems = filterExpensesByMonth(readCachedExpenses(), month);
     var monthTotal = 0;
     monthItems.forEach(function (e) { monthTotal += e.price || 0; });

     var el = document.getElementById('expTodayTotal');
     if (el) el.textContent = todayTotal.toLocaleString() + ' IQD';
     var elM = document.getElementById('expMonthTotal');
     if (elM) elM.textContent = monthTotal.toLocaleString() + ' IQD';
     var elC = document.getElementById('expCount');
     if (elC) elC.textContent = monthItems.length.toString();
 }

 function renderExpensesList(month, items) {
     var list = document.getElementById('expensesList');
     if (!list) return;
     var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;

     if (!items || items.length === 0) {
         list.innerHTML = '<div class="expenses-empty">' +
             '<div class="expenses-empty-icon">📭</div>' +
             '<p>' + S.noExpenses + '</p>' +
         '</div>';
         return;
     }

     var total = 0;
     var rows = '';
     items.forEach(function (item) {
         total += (item.price || 0);
         var ms = expenseTimestampToMs(item);
         var dateObj = ms ? new Date(ms) : null;
         var dateStr = dateObj ? dateObj.toLocaleDateString('ku-IQ') : (item.date || '—');
         var timeStr = dateObj ? dateObj.toLocaleTimeString('ku-IQ', { hour: '2-digit', minute: '2-digit' }) : (item.time || '');
         rows += '<tr class="expense-row">' +
             '<td class="expense-cell expense-cell--name"><span class="expense-name">' + (item.name || '—') + '</span></td>' +
             '<td class="expense-cell expense-cell--price"><span class="expense-price">' + (item.price || 0).toLocaleString() + ' IQD</span></td>' +
             '<td class="expense-cell expense-cell--date"><span class="expense-date">' + dateStr + '</span><span class="expense-time">' + timeStr + '</span></td>' +
             '<td class="expense-cell expense-cell--actions">' +
                 '<button class="btn-danger btn-sm delete-expense" data-id="' + item.id + '">✕</button>' +
             '</td>' +
         '</tr>';
     });

     list.innerHTML = '<div class="expenses-table-wrapper">' +
         '<table class="expenses-table">' +
             '<thead><tr>' +
                 '<th>' + S.expenseName + '</th>' +
                 '<th>' + S.expensePrice + '</th>' +
                 '<th>' + S.expenseDate + '</th>' +
                 '<th></th>' +
             '</tr></thead>' +
             '<tbody>' + rows + '</tbody>' +
             '<tfoot><tr>' +
                 '<td colspan="4" class="expense-total-cell">' +
                     '<span class="expense-total-label">' + S.totalExpenses + ':</span>' +
                     '<span class="expense-total-value">' + total.toLocaleString() + ' IQD</span>' +
                 '</td>' +
             '</tr></tfoot>' +
         '</table></div>';

     list.querySelectorAll('.delete-expense').forEach(function (btn) {
         btn.addEventListener('click', function () {
             deleteExpense(this.getAttribute('data-id'));
         });
     });
 }

 function loadExpenses() {
     var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
     var adminContent = document.getElementById('adminContent');
     var now = new Date();
     var currentMonth = now.getMonth();
     var monthsHtml = '';
     var mNames = ['january','february','march','april','may','june','july','august','september','october','november','december'];
     for (var m = 0; m < 12; m++) {
         monthsHtml += '<option value="' + m + '"' + (m === currentMonth ? ' selected' : '') + '>' + (m + 1) + ' — ' + S[mNames[m]] + ' ' + now.getFullYear() + '</option>';
     }

     adminContent.innerHTML =
         '<div class="expenses-page">' +
             '<div class="expenses-header">' +
                 '<div class="expenses-header-title">' +
                     '<h2>📉 ' + S.expenses + '</h2>' +
                 '</div>' +
                 '<div class="expenses-header-actions">' +
                     '<div class="month-selector">' +
                         '<select id="expensesMonthSelect">' + monthsHtml + '</select>' +
                     '</div>' +
                     '<button class="btn-primary" id="addExpenseBtn">+ ' + S.addExpense + '</button>' +
                 '</div>' +
             '</div>' +
             '<div class="expenses-stats">' +
                 '<div class="expense-stat-card expense-stat--today">' +
                     '<div class="expense-stat-icon">📅</div>' +
                     '<div class="expense-stat-info">' +
                         '<span class="expense-stat-label">' + S.todayExpenses + '</span>' +
                         '<span class="expense-stat-value" id="expTodayTotal">0 IQD</span>' +
                     '</div>' +
                 '</div>' +
                 '<div class="expense-stat-card expense-stat--month">' +
                     '<div class="expense-stat-icon">📊</div>' +
                     '<div class="expense-stat-info">' +
                         '<span class="expense-stat-label">' + S.monthlyExpenses + '</span>' +
                         '<span class="expense-stat-value" id="expMonthTotal">0 IQD</span>' +
                     '</div>' +
                 '</div>' +
                 '<div class="expense-stat-card expense-stat--count">' +
                     '<div class="expense-stat-icon">📋</div>' +
                     '<div class="expense-stat-info">' +
                         '<span class="expense-stat-label">' + S.total + '</span>' +
                         '<span class="expense-stat-value" id="expCount">0</span>' +
                     '</div>' +
                 '</div>' +
             '</div>' +
             '<div class="expenses-table-container">' +
                 '<div id="expensesList"><div class="loading">Loading...</div></div>' +
             '</div>' +
         '</div>' +
         '<div id="expenseModal" class="modal-overlay">' +
             '<div class="modal expense-modal">' +
                 '<div class="modal-content">' +
                     '<span class="modal-close" id="expenseModalClose">&times;</span>' +
                     '<h2 id="expenseModalTitle">' + S.addExpense + '</h2>' +
                     '<form id="expenseForm">' +
                         '<div class="form-group">' +
                             '<label>' + S.expenseName + '</label>' +
                             '<input type="text" id="expenseName" list="expenseSuggestions" required>' +
                             '<datalist id="expenseSuggestions">' +
                                 '<option value="' + S.water + '">' +
                                 '<option value="' + S.milk + '">' +
                                 '<option value="' + S.coffee + '">' +
                                 '<option value="' + S.electric + '">' +
                                 '<option value="' + S.gas + '">' +
                                 '<option value="' + S.rent + '">' +
                                 '<option value="' + S.salary + '">' +
                                 '<option value="' + S.other + '">' +
                             '</datalist>' +
                         '</div>' +
                         '<div class="form-row">' +
                             '<div class="form-group">' +
                                 '<label>' + S.expensePrice + '</label>' +
                                 '<input type="number" id="expensePrice" min="0" required>' +
                             '</div>' +
                             '<div class="form-group">' +
                                 '<label>' + S.expenseDate + '</label>' +
                                 '<input type="date" id="expenseDate" required>' +
                             '</div>' +
                         '</div>' +
                         '<div class="form-group">' +
                             '<label>' + S.expenseTime + '</label>' +
                             '<input type="time" id="expenseTime" required>' +
                         '</div>' +
                         '<button type="submit" class="btn-primary">' + S.saveItem + '</button>' +
                         '<button type="button" class="btn-secondary" id="cancelExpenseBtn" style="margin-left:8px;">' + S.cancel + '</button>' +
                         '<input type="hidden" id="expenseId" value="">' +
                     '</form>' +
                 '</div>' +
             '</div>' +
         '</div>';

     var monthSelect = document.getElementById('expensesMonthSelect');
     if (monthSelect) {
         monthSelect.addEventListener('change', function () {
             var m = parseInt(this.value, 10);
             loadExpensesStats(m);
             loadExpensesList(m);
         });
     }

     var addBtn = document.getElementById('addExpenseBtn');
     if (addBtn) {
         addBtn.addEventListener('click', function () {
             document.getElementById('expenseModalTitle').textContent = S.addExpense;
             document.getElementById('expenseForm').reset();
             document.getElementById('expenseId').value = '';
             var today = new Date().toISOString().split('T')[0];
             var now = new Date().toTimeString().slice(0, 5);
             document.getElementById('expenseDate').value = today;
             document.getElementById('expenseTime').value = now;
             document.getElementById('expenseModal').classList.add('active');
         });
     }

     var closeBtn = document.getElementById('expenseModalClose');
     if (closeBtn) {
         closeBtn.addEventListener('click', function () {
             document.getElementById('expenseModal').classList.remove('active');
         });
     }

     var cancelBtn = document.getElementById('cancelExpenseBtn');
     if (cancelBtn) {
         cancelBtn.addEventListener('click', function () {
             document.getElementById('expenseModal').classList.remove('active');
         });
     }

     var form = document.getElementById('expenseForm');
     if (form) {
         form.addEventListener('submit', function (e) {
             e.preventDefault();
             saveExpense();
         });
     }

     loadExpensesStats(currentMonth);
     loadExpensesList(currentMonth);
 }

 function loadExpensesStats(month) {
     if (month === undefined || month === null) month = new Date().getMonth();
     var year = new Date().getFullYear();

     var today = new Date();
     today.setHours(0, 0, 0, 0);
     var tomorrow = new Date(today);
     tomorrow.setDate(tomorrow.getDate() + 1);

     var mStart = new Date(year, month, 1);
     var mEnd = new Date(year, month + 1, 1);

     if (!isAdminAuthenticated()) {
         paintExpensesStatsFromCache(month);
         return;
     }

     adminProtectedGet(db.collection('expenses').where('timestamp', '>=', today).where('timestamp', '<', tomorrow)).then(function (snap) {
         mergeExpensesSnapIntoCache(snap);
         var total = 0;
         snap.forEach(function (d) { total += (d.data().price || 0); });
         var el = document.getElementById('expTodayTotal');
         if (el) el.textContent = total.toLocaleString() + ' IQD';
     }).catch(function (e) {
         console.error('[expenses] today stats:', e.message || e);
         paintExpensesStatsFromCache(month);
     });

     adminProtectedGet(db.collection('expenses').where('timestamp', '>=', mStart).where('timestamp', '<', mEnd)).then(function (snap) {
         mergeExpensesSnapIntoCache(snap);
         var total = 0;
         var count = 0;
         snap.forEach(function (d) {
             total += (d.data().price || 0);
             count++;
         });
         var elM = document.getElementById('expMonthTotal');
         if (elM) elM.textContent = total.toLocaleString() + ' IQD';
         var elC = document.getElementById('expCount');
         if (elC) elC.textContent = count.toString();
     }).catch(function (e) {
         console.error('[expenses] month stats:', e.message || e);
         paintExpensesStatsFromCache(month);
     });
 }

 function loadExpensesList(month) {
     if (month === undefined || month === null) month = new Date().getMonth();
     var list = document.getElementById('expensesList');
     if (!list) return;
     var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;

     if (!isAdminAuthenticated()) {
         renderExpensesList(month, filterExpensesByMonth(readCachedExpenses(), month));
         return;
     }

     list.innerHTML = '<div class="loading">' + S.loading + '</div>';

     var range = getExpenseMonthRange(month);
     adminProtectedGet(db.collection('expenses')
         .where('timestamp', '>=', range.start)
         .where('timestamp', '<', range.end))
         .then(function (snap) {
             mergeExpensesSnapIntoCache(snap);
             var monthEntries = [];
             snap.forEach(function (doc) {
                 monthEntries.push(expenseEntryFromDoc(doc));
             });
             monthEntries.sort(function (a, b) {
                 return expenseTimestampToMs(b) - expenseTimestampToMs(a);
             });
             renderExpensesList(month, monthEntries);
         })
         .catch(function (e) {
             console.error('[expenses] list:', e.message || e);
             var cached = filterExpensesByMonth(readCachedExpenses(), month);
             if (cached.length > 0) {
                 renderExpensesList(month, cached);
             } else {
                 list.innerHTML = '<p style="color:#C62828;padding:16px;">' + S.errorPrefix + (e.message || 'Could not load expenses') + '</p>';
             }
         });
 }

 function saveExpense() {
     var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
     var name = document.getElementById('expenseName').value.trim();
     var price = document.getElementById('expensePrice').value.trim();
     var date = document.getElementById('expenseDate').value;
     var time = document.getElementById('expenseTime').value;

     if (!name || !price || !date || !time) {
         alert(S.fillAll);
         return;
     }

     var expenseId = document.getElementById('expenseId').value;
     var dateTime = new Date(date + 'T' + time);
     if (isNaN(dateTime.getTime())) {
         alert(S.fillAll);
         return;
     }

     var expenseMonth = dateTime.getMonth();
     var monthSelect = document.getElementById('expensesMonthSelect');
     if (monthSelect) monthSelect.value = String(expenseMonth);

     var tempId = expenseId || ('local-' + Date.now());
     var cacheEntry = {
         id: tempId,
         name: name,
         price: parseFloat(price) || 0,
         date: date,
         time: time,
         timestampSeconds: Math.floor(dateTime.getTime() / 1000)
     };
     upsertCachedExpense(cacheEntry);

     document.getElementById('expenseModal').classList.remove('active');
     renderExpensesList(expenseMonth, filterExpensesByMonth(readCachedExpenses(), expenseMonth));
     loadExpensesStats(expenseMonth);

     var expenseData = {
         name: name,
         price: parseFloat(price) || 0,
         date: date,
         time: time,
         timestamp: firebase.firestore.Timestamp.fromDate(dateTime),
         created_at: firebase.firestore.FieldValue.serverTimestamp()
     };

     var promise;
     if (expenseId) {
         promise = db.collection('expenses').doc(expenseId).update(expenseData);
     } else {
         promise = db.collection('expenses').add(expenseData);
     }

     applyWrite(promise, function () {
         alert(S.expenseSaved);
     });

     if (promise && typeof promise.then === 'function') {
         promise.then(function (ref) {
             if (!expenseId && ref && ref.id) {
                 removeCachedExpense(tempId);
                 upsertCachedExpense(Object.assign({}, cacheEntry, { id: ref.id }));
             }
             loadExpensesList(expenseMonth);
             loadExpensesStats(expenseMonth);
         }).catch(function (err) {
             console.error('Expense save sync error:', err);
         });
     }
 }

 function deleteExpense(expenseId) {
     var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
     if (!confirm(S.deleteExpenseConfirm)) return;

     removeCachedExpense(expenseId);
     var monthSelect = document.getElementById('expensesMonthSelect');
     var month = monthSelect ? parseInt(monthSelect.value, 10) : new Date().getMonth();
     renderExpensesList(month, filterExpensesByMonth(readCachedExpenses(), month));
     loadExpensesStats(month);

     applyWrite(db.collection('expenses').doc(expenseId).delete(), function () {
         alert(S.expenseDeleted);
         loadExpensesList(month);
         loadExpensesStats(month);
     });
 }

 /* ============ LOGOUT ============ */

function handleLogout() {
    if (window.auth) {
        auth.signOut().then(function () {
            window.location.href = 'login.html';
        }).catch(function () {
            window.location.href = 'login.html';
        });
    } else {
        window.location.href = 'login.html';
    }
}
