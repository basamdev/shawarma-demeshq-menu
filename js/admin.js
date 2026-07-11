// Admin.js — Shawarma Admin Panel

var USE_LOCAL_API = false;
var API_BASE = 'api';

if (USE_LOCAL_API && typeof console !== 'undefined' && console.error) {
    var originalConsoleError = console.error;
    console.error = function() {
        var args = Array.prototype.slice.call(arguments);
        var msg = args.join(' ');
        if (msg.indexOf('Cloud Firestore API') !== -1 || 
            msg.indexOf('Could not reach Cloud Firestore backend') !== -1 ||
            msg.indexOf('firestore.googleapis.com') !== -1) {
            return;
        }
        originalConsoleError.apply(console, args);
    };
}

function localApiRequest(endpoint, options) {
    options = options || {};
    // Resolve the API URL absolutely so requests work regardless of how the
    // page is served (relative URLs break when the document and API differ
    // in origin/path).
    var url = (typeof getApiUrl === 'function') ? getApiUrl(endpoint) : (API_BASE + '/' + endpoint);
    var method = options.method || 'GET';
    var body = options.body || null;
    var headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };
    
    var config = {
        method: method,
        headers: headers,
        mode: 'cors',
        credentials: 'include'
    };
    
    if (body) {
        config.body = JSON.stringify(body);
    }
    
    return fetch(url, config).then(function(response) {
        if (!response.ok) {
            return response.json().then(function(err) {
                throw new Error(err.error || 'HTTP ' + response.status);
            }).catch(function() {
                throw new Error('HTTP ' + response.status);
            });
        }
        return response.json();
    });
}

const orderItems = [];
let activeItemModal = null;
let cashierUnsubscribe = null;
let cashierActiveFilter = 'all';
let categoriesUnsubscribe = null;
let itemsUnsubscribe = null;
var dashboardUnsubscribes = [];
var _itemsSnapDocs = [];
var _adminSalesLive = null;
var _adminExpensesLive = null;
var _adminLiveListenersStarted = false;
var _adminResetInProgress = false;
window._firestoreApiDisabled = false;
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
        syncSalesLiveFromCache();
    } catch (e) {}
}

function syncSalesLiveFromCache() {
    _adminSalesLive = readCachedSales().slice();
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
    var isSingleDay = endMs - startMs <= 90000000;
    readCachedExpenses().forEach(function (e) {
        if (isSingleDay && isExpenseOnLocalDay(e, start)) {
            total += e.price || 0;
            return;
        }
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
    tasks.push(warmExpensesCacheFromServer());
    tasks.push(warmSalesCacheFromServer());
    Promise.all(tasks).then(function () {
        try { localStorage.setItem('adminCacheWarmedAt', String(Date.now())); } catch (e) {}
        hydrateAdminFromLocalCache();
        if (typeof done === 'function') done();
    }).catch(function () {
        hydrateAdminFromLocalCache();
        if (typeof done === 'function') done();
    });
}

var ADMIN_VERSION = 'v102';

function getDashboardMonth() {
    var sel = document.getElementById('dashboardMonthSelect');
    return sel ? parseInt(sel.value, 10) : new Date().getMonth();
}

function getExpensesMonth() {
    var sel = document.getElementById('expensesMonthSelect');
    return sel ? parseInt(sel.value, 10) : new Date().getMonth();
}

function getSalesDataSource() {
    var cached = readCachedSales();
    if (_adminSalesLive !== null && _adminSalesLive.length) return _adminSalesLive;
    return cached;
}

function syncExpensesLiveFromCache() {
    _adminExpensesLive = readCachedExpenses().slice();
}

function mergeServerExpensesIntoCache(snap) {
    if (_adminResetInProgress) return readCachedExpenses();
    var fromServer = [];
    if (snap && !snap.empty) {
        snap.forEach(function (d) {
            fromServer.push(expenseEntryFromDoc(d));
        });
    }
    var serverIds = {};
    fromServer.forEach(function (e) { serverIds[e.id] = true; });
    var pending = readCachedExpenses().filter(function (e) {
        return String(e.id).indexOf('local-') === 0 && !serverIds[e.id];
    });
    var merged = fromServer.concat(pending).map(normalizeExpenseEntry);
    _adminExpensesLive = merged;
    writeCachedExpenses(merged);
    return merged;
}

function getExpensesDataSource() {
    var cached = readCachedExpenses();
    if (_adminExpensesLive !== null && _adminExpensesLive.length) return _adminExpensesLive;
    return cached;
}

function deriveExpenseTimestampSeconds(entry) {
    if (!entry) return null;
    if (entry.timestampSeconds != null && !isNaN(entry.timestampSeconds)) {
        return entry.timestampSeconds;
    }
    if (entry.date && entry.time) {
        var d = new Date(entry.date + 'T' + entry.time);
        if (!isNaN(d.getTime())) return Math.floor(d.getTime() / 1000);
    }
    var ts = entry.timestamp;
    if (typeof ts === 'string') {
        var p = new Date(ts);
        if (!isNaN(p.getTime())) return Math.floor(p.getTime() / 1000);
    }
    if (ts && ts.seconds != null) return ts.seconds;
    if (ts && ts._seconds != null) return ts._seconds;
    if (ts && typeof ts.toDate === 'function') return Math.floor(ts.toDate().getTime() / 1000);
    return null;
}

function normalizeExpenseEntry(entry) {
    if (!entry) return entry;
    var sec = deriveExpenseTimestampSeconds(entry);
    if (sec != null) entry.timestampSeconds = sec;
    if (!entry.date && entry.timestampSeconds) {
        entry.date = getLocalDateKey(new Date(entry.timestampSeconds * 1000));
    }
    if (!entry.time && entry.timestampSeconds) {
        var td = new Date(entry.timestampSeconds * 1000);
        entry.time = pad2Local(td.getHours()) + ':' + pad2Local(td.getMinutes());
    }
    return entry;
}

function pad2Local(n) {
    return String(n).padStart(2, '0');
}

function getLocalDateKey(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad2Local(d.getMonth() + 1) + '-' + pad2Local(d.getDate());
}

function expenseCalendarDateKey(item) {
    if (!item) return '';
    if (item.date) return String(item.date).slice(0, 10);
    var sec = deriveExpenseTimestampSeconds(item);
    return sec != null ? getLocalDateKey(new Date(sec * 1000)) : '';
}

function isExpenseOnLocalDay(item, dayStart) {
    return expenseCalendarDateKey(item) === getLocalDateKey(dayStart);
}

function isExpenseInMonth(item, month, year) {
    year = year == null ? new Date().getFullYear() : year;
    var key = expenseCalendarDateKey(item);
    if (key) {
        var parts = key.split('-');
        return parseInt(parts[0], 10) === year && parseInt(parts[1], 10) - 1 === month;
    }
    var ms = deriveExpenseTimestampSeconds(item);
    if (ms == null) return false;
    var d = new Date(ms * 1000);
    return d.getFullYear() === year && d.getMonth() === month;
}

function mergeServerSalesIntoCache(snap) {
    if (_adminResetInProgress) return readCachedSales();
    var fromServer = [];
    if (snap && !snap.empty) {
        snap.forEach(function (d) {
            fromServer.push(saleEntryFromDoc(d));
        });
    }
    var serverIds = {};
    fromServer.forEach(function (s) { serverIds[s.id] = true; });
    var pending = readCachedSales().filter(function (s) {
        return String(s.id).indexOf('local-') === 0 && !serverIds[s.id];
    });
    var merged = fromServer.concat(pending);
    _adminSalesLive = merged;
    writeCachedSales(merged);
    return merged;
}

function mergeRestExpensesDocs(docs) {
    if (_adminResetInProgress) return readCachedExpenses();
    var fromServer = restDocsToExpenses(docs || []);
    var serverIds = {};
    fromServer.forEach(function (e) { serverIds[e.id] = true; });
    var pending = readCachedExpenses().filter(function (e) {
        return String(e.id).indexOf('local-') === 0 && !serverIds[e.id];
    });
    var merged = fromServer.concat(pending).map(normalizeExpenseEntry);
    _adminExpensesLive = merged;
    writeCachedExpenses(merged);
    return merged;
}

function mergeRestSalesDocs(docs) {
    if (_adminResetInProgress) return readCachedSales();
    var fromServer = restDocsToSales(docs || []);
    var serverIds = {};
    fromServer.forEach(function (s) { serverIds[s.id] = true; });
    var pending = readCachedSales().filter(function (s) {
        return String(s.id).indexOf('local-') === 0 && !serverIds[s.id];
    });
    var merged = fromServer.concat(pending);
    _adminSalesLive = merged;
    writeCachedSales(merged);
    return merged;
}

function clearAdminSalesExpensesCache() {
    _adminSalesLive = [];
    _adminExpensesLive = [];
    writeCachedSales([]);
    writeCachedExpenses([]);
}

function hydrateAdminFromLocalCache() {
    var sales = readCachedSales();
    var expenses = readCachedExpenses();
    if (sales.length > 0) _adminSalesLive = sales;
    if (expenses.length > 0) _adminExpensesLive = expenses;
}

function isFirestoreCacheEmptySnap(snap) {
    return !!(snap && snap.empty && snap.metadata && snap.metadata.fromCache);
}

function fetchPublicCollectionViaRest(collectionName, timeoutMs) {
    timeoutMs = timeoutMs || 12000;
    var cfg = window.firebaseConfig;
    if (!cfg || !cfg.projectId || !cfg.apiKey) {
        return Promise.reject(new Error('No config'));
    }
    var baseUrl = getFirestoreRestBaseUrl();
    var url = baseUrl + encodeURIComponent(cfg.projectId) +
        '/databases/(default)/documents/' + encodeURIComponent(collectionName) +
        '?key=' + encodeURIComponent(cfg.apiKey);
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = null;
    var opts = { cache: 'no-store' };
    if (controller) {
        timer = setTimeout(function () { controller.abort(); }, timeoutMs);
        opts.signal = controller.signal;
    }
    return fetch(url, opts).then(function (r) {
        if (timer) clearTimeout(timer);
        if (!r.ok) {
            return r.text().then(function (body) {
                var msg = 'REST HTTP ' + r.status;
                if (body && body.indexOf('Cloud Firestore API has not been used') !== -1) {
                    window._firestoreApiDisabled = true;
                    msg = body;
                }
                throw new Error(msg);
            });
        }
        return r.json();
    }).then(parseRestDocuments).catch(function (e) {
        if (timer) clearTimeout(timer);
        if (isFirestoreApiDisabledError(e)) showFirestoreApiDisabledAlert();
        throw e;
    });
}

function fetchMenuItemsForAdmin(timeoutMs) {
    if (typeof fetchMenuViaRest === 'function') {
        return fetchMenuViaRest(timeoutMs || 12000);
    }
    if (window._firestoreApiDisabled) return Promise.resolve([]);
    return fetchPublicCollectionViaRest('menuItems', timeoutMs).then(function (docs) {
        return docs.map(function (d) {
            return Object.assign({ id: d.id }, d.data || {});
        });
    });
}

function fetchCategoriesForAdmin(timeoutMs) {
    if (window._firestoreApiDisabled) return Promise.resolve([]);
    return fetchPublicCollectionViaRest('categories', timeoutMs).then(function (docs) {
        return docs.map(function (d) { return { id: d.id, data: d.data || {} }; });
    });
}

function restFieldValue(field) {
    if (!field) return null;
    if ('stringValue' in field) return field.stringValue;
    if ('integerValue' in field) return parseInt(field.integerValue, 10);
    if ('doubleValue' in field) return field.doubleValue;
    if ('booleanValue' in field) return field.booleanValue;
    if ('timestampValue' in field) return field.timestampValue;
    if ('arrayValue' in field) {
        return (field.arrayValue.values || []).map(restFieldValue);
    }
    if ('mapValue' in field) {
        var o = {};
        var fields = field.mapValue.fields || {};
        Object.keys(fields).forEach(function (k) { o[k] = restFieldValue(fields[k]); });
        return o;
    }
    return null;
}

function parseRestDocuments(json) {
    var docs = [];
    (json.documents || []).forEach(function (doc) {
        var parts = (doc.name || '').split('/');
        var id = parts[parts.length - 1];
        var data = {};
        var fields = doc.fields || {};
        Object.keys(fields).forEach(function (k) { data[k] = restFieldValue(fields[k]); });
        docs.push({ id: id, data: data });
    });
    return docs;
}

function fetchAdminCollectionViaRest(collectionName, timeoutMs) {
    if (window._firestoreApiDisabled) return Promise.resolve([]);
    return fetchAllAdminCollectionViaRest(collectionName, timeoutMs);
}

function getFirestoreRestBaseUrl() {
    var emulatorInfo = window._firestoreEmulatorInfo;
    if (emulatorInfo) {
        return 'http://' + emulatorInfo.host + ':' + emulatorInfo.port + '/v1/projects/';
    }
    return 'https://firestore.googleapis.com/v1/projects/';
}

function fetchAllAdminCollectionViaRest(collectionName, timeoutMs) {
    timeoutMs = timeoutMs || 15000;
    if (!isAdminAuthenticated()) return Promise.reject(new Error('Not signed in'));
    var cfg = window.firebaseConfig;
    if (!cfg || !cfg.projectId) return Promise.reject(new Error('No config'));

    function fetchPage(pageToken) {
        return auth.currentUser.getIdToken().then(function (token) {
            var baseUrl = getFirestoreRestBaseUrl();
            var url = baseUrl + encodeURIComponent(cfg.projectId) +
                '/databases/(default)/documents/' + encodeURIComponent(collectionName);
            if (pageToken) url += '?pageToken=' + encodeURIComponent(pageToken);
            var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
            var timer = null;
            var opts = { cache: 'no-store', headers: { Authorization: 'Bearer ' + token } };
            if (controller) {
                timer = setTimeout(function () { controller.abort(); }, timeoutMs);
                opts.signal = controller.signal;
            }
            return fetch(url, opts).then(function (r) {
                if (timer) clearTimeout(timer);
                if (!r.ok) {
                    return r.text().then(function (body) {
                        var msg = 'REST HTTP ' + r.status;
                        if (body && body.indexOf('Cloud Firestore API has not been used') !== -1) {
                            window._firestoreApiDisabled = true;
                            msg = body;
                        } else if (body) {
                            msg += ': ' + body.slice(0, 160);
                        }
                        throw new Error(msg);
                    });
                }
                return r.json();
            }).then(function (json) {
                var docs = parseRestDocuments(json);
                if (json.nextPageToken) {
                    return fetchPage(json.nextPageToken).then(function (more) {
                        return docs.concat(more);
                    });
                }
                return docs;
            }).catch(function (e) {
                if (timer) clearTimeout(timer);
                throw e;
            });
        });
    }

    return fetchPage(null).catch(function (err) {
        if (isFirestoreApiDisabledError(err)) {
            showFirestoreApiDisabledAlert();
        }
        throw err;
    });
}

function deleteCollectionDocumentsByIds(collectionName, docIds) {
    if (!docIds || !docIds.length) return Promise.resolve();
    if (!window.db) return Promise.reject(new Error('Firestore not ready'));

    var promises = [];
    for (var i = 0; i < docIds.length; i += 500) {
        var batch = db.batch();
        var chunk = docIds.slice(i, i + 500);
        chunk.forEach(function (id) {
            batch.delete(db.collection(collectionName).doc(id));
        });
        promises.push(batch.commit());
    }
    return Promise.all(promises);
}

function deleteAdminCollectionFromServer(collectionName) {
    return fetchAllAdminCollectionViaRest(collectionName).then(function (docs) {
        var ids = (docs || []).map(function (d) { return d.id; }).filter(Boolean);
        if (!ids.length) return { deleted: 0, remaining: 0 };
        return deleteCollectionDocumentsByIds(collectionName, ids).then(function () {
            return fetchAllAdminCollectionViaRest(collectionName).then(function (remaining) {
                return { deleted: ids.length, remaining: (remaining || []).length };
            });
        });
    });
}

function promiseWithTimeout(promise, ms, message) {
    return Promise.race([
        promise,
        new Promise(function (_, reject) {
            setTimeout(function () { reject(new Error(message || 'timeout')); }, ms);
        })
    ]);
}

function jsToRestFields(obj) {
    var fields = {};
    Object.keys(obj || {}).forEach(function (key) {
        var v = obj[key];
        if (v === undefined || v === null) return;
        if (typeof v === 'string') {
            fields[key] = { stringValue: v };
        } else if (typeof v === 'boolean') {
            fields[key] = { booleanValue: v };
        } else if (typeof v === 'number' && !isNaN(v)) {
            if (Number.isInteger(v)) fields[key] = { integerValue: String(v) };
            else fields[key] = { doubleValue: v };
        }
    });
    return fields;
}

function writeDocumentViaRest(collectionName, docId, plainData, isCreate) {
    if (!isAdminAuthenticated()) return Promise.reject(new Error('Not signed in'));
    var cfg = window.firebaseConfig;
    if (!cfg || !cfg.projectId) return Promise.reject(new Error('No config'));
    var payload = { fields: jsToRestFields(plainData) };
    return auth.currentUser.getIdToken().then(function (token) {
        var base = getFirestoreRestBaseUrl() + encodeURIComponent(cfg.projectId) +
            '/databases/(default)/documents/' + encodeURIComponent(collectionName);
        var url = isCreate
            ? base + '?documentId=' + encodeURIComponent(docId)
            : base + '/' + encodeURIComponent(docId);
        return fetch(url, {
            method: isCreate ? 'POST' : 'PATCH',
            cache: 'no-store',
            headers: {
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        }).then(function (r) {
            if (!r.ok) {
                return r.text().then(function (t) {
                    throw new Error('REST HTTP ' + r.status + (t ? ': ' + t.slice(0, 160) : ''));
                });
            }
            return r.json();
        });
    });
}

function deleteDocumentViaRest(collectionName, docId) {
    if (!isAdminAuthenticated()) return Promise.reject(new Error('Not signed in'));
    var cfg = window.firebaseConfig;
    if (!cfg || !cfg.projectId) return Promise.reject(new Error('No config'));
    return auth.currentUser.getIdToken().then(function (token) {
        var url = getFirestoreRestBaseUrl() + encodeURIComponent(cfg.projectId) +
            '/databases/(default)/documents/' + encodeURIComponent(collectionName) + '/' +
            encodeURIComponent(docId);
        return fetch(url, {
            method: 'DELETE',
            cache: 'no-store',
            headers: { Authorization: 'Bearer ' + token }
        }).then(function (r) {
            if (!r.ok && r.status !== 404) {
                return r.text().then(function (t) {
                    throw new Error('REST HTTP ' + r.status + (t ? ': ' + t.slice(0, 160) : ''));
                });
            }
            return true;
        });
    });
}

/** Menu writes: SDK first (8s), then Firestore REST — mobile SDK often hangs. */
function applyMenuCloudWrite(config) {
    if (!config || !config.onDone) return;

    if (!navigator.onLine) {
        applyWrite(config.sdkPromise, config.onDone, config.onError, {});
        return;
    }

    function restFallback(err) {
        console.warn('[menu cloud write] SDK failed, REST fallback:', err && (err.message || err));
        var restPromise;
        if (config.isDelete) {
            restPromise = deleteDocumentViaRest(config.collection, config.docId);
        } else {
            restPromise = writeDocumentViaRest(
                config.collection,
                config.docId,
                config.plainData,
                !!config.isCreate
            );
        }
        restPromise.then(function () {
            config.onDone(false);
        }).catch(function (e) {
            if (typeof config.onError === 'function') config.onError(e);
        });
    }

    if (!config.sdkPromise || typeof config.sdkPromise.then !== 'function') {
        restFallback(new Error('No SDK promise'));
        return;
    }

    promiseWithTimeout(config.sdkPromise, 8000, 'SDK write timeout').then(function () {
        config.onDone(false);
    }).catch(restFallback);
}

function restDocsToSales(docs) {
    return docs.map(function (d) {
        var ts = d.data.timestamp;
        var timestampSeconds = null;
        if (typeof ts === 'string') {
            var parsed = new Date(ts);
            if (!isNaN(parsed.getTime())) timestampSeconds = Math.floor(parsed.getTime() / 1000);
        }
        return {
            id: d.id,
            items: d.data.items || [],
            total: d.data.total || 0,
            timestampSeconds: timestampSeconds,
            cashier: d.data.cashier
        };
    });
}

function restDocsToExpenses(docs) {
    return docs.map(function (d) {
        var ts = d.data.timestamp;
        var timestampSeconds = null;
        if (typeof ts === 'string') {
            var parsed = new Date(ts);
            if (!isNaN(parsed.getTime())) timestampSeconds = Math.floor(parsed.getTime() / 1000);
        }
        return normalizeExpenseEntry({
            id: d.id,
            name: d.data.name,
            price: d.data.price || 0,
            date: d.data.date,
            time: d.data.time,
            timestamp: ts,
            timestampSeconds: timestampSeconds
        });
    });
}

function warmSalesCacheFromServer() {
    if (_adminResetInProgress) {
        writeCachedSales([]);
        return Promise.resolve();
    }
    if (window._firestoreApiDisabled) return Promise.resolve();
    if (USE_LOCAL_API) {
        return localApiRequest('sales.php').then(function(docs) {
            mergeRestSalesDocs(docs || []);
        }).catch(function(err) {
            console.warn('[sales] Local API failed:', err.message);
        });
    }
    if (isAdminAuthenticated() && navigator.onLine) {
        return fetchAllAdminCollectionViaRest('sales').then(function (docs) {
            mergeRestSalesDocs(docs || []);
        }).catch(function (err) {
            if (isFirestoreApiDisabledError(err)) {
                showFirestoreApiDisabledAlert();
            }
            return salesCacheFromSdkServer();
        });
    }
    return salesCacheFromSdkServer();
}

function salesCacheFromSdkServer() {
    return db.collection('sales').get({ source: 'server' }).then(function (snap) {
        var sales = [];
        snap.forEach(function (d) { sales.push(saleEntryFromDoc(d)); });
        writeCachedSales(sales);
    }).catch(function (err) {
        if (isFirestoreApiDisabledError(err)) {
            showFirestoreApiDisabledAlert();
        }
        return db.collection('sales').get().then(function (snap) {
            var sales = [];
            snap.forEach(function (d) { sales.push(saleEntryFromDoc(d)); });
            writeCachedSales(sales);
        }).catch(function () {
            writeCachedSales([]);
        });
    });
}

function warmExpensesCacheFromServer() {
    if (_adminResetInProgress) {
        writeCachedExpenses([]);
        return Promise.resolve();
    }
    if (window._firestoreApiDisabled) return Promise.resolve();
    if (USE_LOCAL_API) {
        return localApiRequest('expenses.php').then(function(docs) {
            mergeRestExpensesDocs(docs || []);
        }).catch(function(err) {
            console.warn('[expenses] Local API failed:', err.message);
        });
    }
    if (isAdminAuthenticated() && navigator.onLine) {
        return fetchAllAdminCollectionViaRest('expenses').then(function (docs) {
            mergeRestExpensesDocs(docs || []);
        }).catch(function (err) {
            if (isFirestoreApiDisabledError(err)) {
                showFirestoreApiDisabledAlert();
            }
            return expensesCacheFromSdkServer();
        });
    }
    return expensesCacheFromSdkServer();
}

function expensesCacheFromSdkServer() {
    return db.collection('expenses').get({ source: 'server' }).then(function (snap) {
        var expenses = [];
        snap.forEach(function (d) { expenses.push(expenseEntryFromDoc(d)); });
        writeCachedExpenses(expenses);
    }).catch(function (err) {
        if (isFirestoreApiDisabledError(err)) {
            showFirestoreApiDisabledAlert();
        }
        return db.collection('expenses').get().then(function (snap) {
            var expenses = [];
            snap.forEach(function (d) { expenses.push(expenseEntryFromDoc(d)); });
            writeCachedExpenses(expenses);
        }).catch(function () {
            writeCachedExpenses([]);
        });
    });
}

function shouldIgnoreCachedFirestoreSnap(snap) {
    return !!(navigator.onLine &&
        isAdminAuthenticated() &&
        snap &&
        snap.metadata &&
        snap.metadata.fromCache &&
        !snap.metadata.hasPendingWrites);
}

function syncAdminFinancialsFromServer(callback) {
    if (!isAdminAuthenticated() || !navigator.onLine) {
        if (typeof callback === 'function') callback();
        return Promise.resolve();
    }
    return Promise.all([
        warmSalesCacheFromServer(),
        warmExpensesCacheFromServer()
    ]).then(function () {
        syncSalesLiveFromCache();
        syncExpensesLiveFromCache();
        refreshAdminCurrentSection();
        if (typeof callback === 'function') callback();
    }).catch(function (err) {
        console.warn('[sync] financials:', err && err.message ? err.message : err);
        if (typeof callback === 'function') callback();
    });
}

function scheduleAdminRestFallback() {
    if (window._firestoreApiDisabled) return;
    setTimeout(function () {
        if (!isAdminAuthenticated()) return;
        if (_adminSalesLive === null) {
            fetchAdminCollectionViaRest('sales').then(function (docs) {
                mergeRestSalesDocs(docs);
                refreshAdminCurrentSection();
            }).catch(function (e) {
                console.warn('[REST] sales fallback:', e.message || e);
                _adminSalesLive = readCachedSales();
                refreshAdminCurrentSection();
            });
        }
        if (_adminExpensesLive === null) {
            fetchAdminCollectionViaRest('expenses').then(function (docs) {
                mergeRestExpensesDocs(docs);
                refreshAdminCurrentSection();
            }).catch(function (e) {
                console.warn('[REST] expenses fallback:', e.message || e);
                _adminExpensesLive = readCachedExpenses();
                refreshAdminCurrentSection();
            });
        }
    }, 4000);
}

function startAdminLiveListeners() {
    hydrateAdminFromLocalCache();
    refreshAdminCurrentSection();

    if (_adminLiveListenersStarted || !window.db) return;
    if (!isAdminAuthenticated()) {
        if (!navigator.onLine) _adminLiveListenersStarted = true;
        return;
    }
    _adminLiveListenersStarted = true;

    if (navigator.onLine) {
        fetchAdminCollectionViaRest('sales').then(function (docs) {
            mergeRestSalesDocs(docs || []);
            refreshAdminCurrentSection();
        }).catch(function (e) { console.warn('[REST] sales:', e.message || e); });

        fetchAdminCollectionViaRest('expenses').then(function (docs) {
            mergeRestExpensesDocs(docs || []);
            refreshAdminCurrentSection();
        }).catch(function (e) { console.warn('[REST] expenses:', e.message || e); });
    }

    function applySalesSnap(snap) {
        if (_adminResetInProgress) return;
        if (shouldIgnoreCachedFirestoreSnap(snap)) return;
        if (snap.empty) {
            if (isFirestoreCacheEmptySnap(snap)) {
                hydrateAdminFromLocalCache();
            } else {
                var cachedSales = readCachedSales();
                var pendingSales = cachedSales.filter(function (s) { return String(s.id).indexOf('local-') === 0; });
                if (pendingSales.length) {
                    _adminSalesLive = pendingSales;
                    writeCachedSales(pendingSales);
                } else if (!cachedSales.length) {
                    _adminSalesLive = [];
                    writeCachedSales([]);
                }
            }
            refreshAdminCurrentSection();
            return;
        }
        mergeServerSalesIntoCache(snap);
        if (document.getElementById('todaySales')) renderDashboardUI(getDashboardMonth());
        if (document.getElementById('recentSalesContainer')) renderRecentSalesUI();
    }

    function applyExpensesSnap(snap) {
        if (_adminResetInProgress) return;
        if (shouldIgnoreCachedFirestoreSnap(snap)) return;
        if (snap.empty) {
            if (isFirestoreCacheEmptySnap(snap)) {
                hydrateAdminFromLocalCache();
            } else {
                var cached = readCachedExpenses();
                var pending = cached.filter(function (e) { return String(e.id).indexOf('local-') === 0; });
                if (pending.length) {
                    _adminExpensesLive = pending;
                    writeCachedExpenses(pending);
                } else if (!cached.length) {
                    _adminExpensesLive = [];
                    writeCachedExpenses([]);
                }
            }
            refreshAdminCurrentSection();
            return;
        }
        mergeServerExpensesIntoCache(snap);
        if (document.getElementById('todaySales')) renderDashboardUI(getDashboardMonth());
        if (document.getElementById('expensesList')) renderExpensesUI(getExpensesMonth());
    }

    var salesUnsub = db.collection('sales').onSnapshot(applySalesSnap, function (e) {
        console.error('[live] sales error:', e);
        hydrateAdminFromLocalCache();
        refreshAdminCurrentSection();
    });
    dashboardUnsubscribes.push(salesUnsub);

    var expUnsub = db.collection('expenses').onSnapshot(applyExpensesSnap, function (e) {
        console.error('[live] expenses error:', e);
        hydrateAdminFromLocalCache();
        refreshAdminCurrentSection();
    });
    dashboardUnsubscribes.push(expUnsub);

    if (navigator.onLine) scheduleAdminRestFallback();
}

function isAdminAuthenticated() {
    if (USE_LOCAL_API) {
        var token = window.currentAuthToken || localStorage.getItem('adminAuthToken');
        var user = window.currentUser || localStorage.getItem('adminUser');
        return !!(token && user);
    }
    return !!(window.auth && auth.currentUser);
}

function isFirestoreApiDisabledError(err) {
    if (!err || !err.message) return false;
    var m = err.message;
    var disabled = m.indexOf('Cloud Firestore API has not been used in project') !== -1 ||
        m.indexOf('SERVICE_DISABLED') !== -1 ||
        m.indexOf('firestore.googleapis.com/overview') !== -1 ||
        (m.indexOf('firestore.googleapis.com') !== -1 && m.indexOf('disabled') !== -1);
    if (disabled) {
        window._firestoreApiDisabled = true;
    }
    return disabled;
}

function isFirestorePermissionError(err) {
    if (!err || !err.message) return false;
    var msg = err.message.toLowerCase();
    return msg.indexOf('permission') !== -1 ||
        msg.indexOf('insufficient') !== -1 ||
        err.code === 'permission-denied' ||
        err.code === 'PERMISSION_DENIED' ||
        msg.indexOf('app check') !== -1 ||
        msg.indexOf('appcheck') !== -1;
}

function showFirestoreApiDisabledAlert() {
    if (window._firestoreApiDisabledAlerted) return;
    window._firestoreApiDisabledAlerted = true;
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var projectId = (window.firebaseConfig && window.firebaseConfig.projectId) || 'shawarma-demashq-menu';
    var url = 'https://console.developers.google.com/apis/api/firestore.googleapis.com/overview?project=' + encodeURIComponent(projectId);
    alert('⚠️ ' + (S.errorPrefix || 'Error:') + '\n\nCloud Firestore API is disabled for this project.\n\nPlease enable it here:\n' + url + '\n\nAfter enabling, wait a few minutes and refresh this page.');
}

var _adminAuthInitialized = false;
window.adminAuthReady = new Promise(function (resolve) {
    if (USE_LOCAL_API) {
        _adminAuthInitialized = true;
        var storedToken = localStorage.getItem('adminAuthToken');
        var storedUser = localStorage.getItem('adminUser');
        if (storedToken && storedUser) {
            try {
                window.currentAuthToken = storedToken;
                window.currentUser = JSON.parse(storedUser);
                resolve(window.currentUser);
                syncAdminFinancialsFromServer();
                warmAdminOfflineCache();
                startAdminLiveListeners();
                refreshAdminCurrentSection();
            } catch (e) {
                localStorage.removeItem('adminAuthToken');
                localStorage.removeItem('adminUser');
                resolve(null);
                if (navigator.onLine) {
                    window.location.href = 'login.html';
                } else {
                    hydrateAdminFromLocalCache();
                    refreshAdminCurrentSection();
                }
            }
        } else {
            resolve(null);
            if (navigator.onLine) {
                window.location.href = 'login.html';
            } else {
                hydrateAdminFromLocalCache();
                refreshAdminCurrentSection();
            }
        }
        return;
    }
    
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
            syncAdminFinancialsFromServer();
            warmAdminOfflineCache();
            startAdminLiveListeners();
            refreshAdminCurrentSection();
        } else if (!navigator.onLine) {
            hydrateAdminFromLocalCache();
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
    ms = ms || (navigator.onLine ? 10000 : 8000);
    var cacheSnap = null;

    function raceServer() {
        return Promise.race([
            queryOrRef.get({ source: 'server' }),
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
        if (isFirestoreApiDisabledError(err)) {
            showFirestoreApiDisabledAlert();
        }
        if (cacheSnap && !cacheSnap.empty) return cacheSnap;
        throw err;
    });
}

function refreshAdminCurrentSection() {
    var activeBtn = document.querySelector('.admin-nav-btn.active');
    if (!activeBtn) return;
    var section = activeBtn.getAttribute('data-section');
    if (section === 'dashboard' && document.getElementById('todaySales')) {
        renderDashboardUI(getDashboardMonth());
        renderRecentSalesUI();
    } else if (section === 'expenses' && document.getElementById('expensesList')) {
        renderExpensesUI(getExpensesMonth());
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
    hydrateAdminFromLocalCache();

    var LOGO_CANDIDATES = [
        'assets/shawarma demeshq-logo.jpg',
        'assets/logo.svg'
    ];
    window.fallbackLogo = function (img) {
        if (!img || !(img instanceof HTMLImageElement)) return;
        if (img.dataset.logoFallbackDone === '1') return;
        var next = parseInt(img.dataset.logoTry || '1', 10);
        if (next < LOGO_CANDIDATES.length) {
            img.dataset.logoTry = String(next + 1);
            img.src = LOGO_CANDIDATES[next] + '?v=83';
            return;
        }
        img.dataset.logoFallbackDone = '1';
        img.onerror = null;
        img.style.display = 'none';
        var wrap = img.closest('.sidebar-brand') || img.parentElement;
        if (wrap && !wrap.querySelector('.logo-fallback-initials')) {
            var fallback = document.createElement('span');
            fallback.className = 'logo-fallback-initials';
            fallback.textContent = 'AC';
            fallback.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:46px;height:46px;border-radius:50%;background:linear-gradient(135deg,#3B82F6,#1D4ED8);color:#fff;font-weight:800;font-size:1.1rem;font-family:var(--font-body);flex-shrink:0;border:2px solid rgba(59,130,246,0.35);box-shadow:0 2px 12px rgba(59,130,246,0.25);';
            wrap.insertBefore(fallback, wrap.firstChild);
        }
    };

    applyAdminAccent(localStorage.getItem('adminAccent') || 'sapphire');
    initAdminPanel();
    wireAdminLangButtons();
    initSidebar();

    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState !== 'visible') return;
        if (!isAdminAuthenticated() || !navigator.onLine) return;
        syncAdminFinancialsFromServer();
    });

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
        loadAdminSection(defaultBtn.getAttribute('data-section'));
        whenAdminReady(function () {
            startAdminLiveListeners();
            refreshAdminCurrentSection();
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
    var lang = localStorage.getItem('selectedLang') || 'ku';
    var locale = lang === 'ar' ? 'ar-IQ' : (lang === 'ku' ? 'ku-IQ' : 'en-US');

    function format12(dateObj) {
        if (!dateObj || isNaN(dateObj.getTime())) return '\u2014';
        return dateObj.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
    }

    if (ts instanceof Date) return format12(ts);
    if (typeof ts.toDate === 'function') return format12(ts.toDate());
    if (ts.seconds != null) return format12(new Date(ts.seconds * 1000));
    if (ts._seconds != null) return format12(new Date(ts._seconds * 1000));
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
            '<div id="dailySalesContainer"></div>' +
        '</div>' +
        '<div class="card" style="margin-top:20px;">' +
            '<h2>' + S.recentSales + '</h2>' +
            '<div id="recentSalesContainer"></div>' +
        '</div>';
    var monthSelect = document.getElementById('dashboardMonthSelect');
    if (monthSelect) {
        monthSelect.addEventListener('change', function () {
            renderDashboardUI(parseInt(this.value, 10));
        });
    }
    renderDashboardUI(currentMonth);
    renderRecentSalesUI();
    startAdminLiveListeners();
    syncAdminFinancialsFromServer(function () {
        renderDashboardUI(currentMonth);
        renderRecentSalesUI();
    });
}

function renderDashboardUI(month) {
    if (month === undefined || month === null) month = new Date().getMonth();
    var year = new Date().getFullYear();
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;

    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    var mStart = new Date(year, month, 1);
    var mEnd = new Date(year, month + 1, 1);
    var startMs = mStart.getTime();
    var endMs = mEnd.getTime();
    var todayMs = today.getTime();
    var tomorrowMs = tomorrow.getTime();

    var sales = readCachedSales();
    var expenses = readCachedExpenses();
    var lang = localStorage.getItem('selectedLang') || 'ku';

    var todaySalesTotal = 0;
    var todayOrderCount = 0;
    var monthlyTotal = 0;
    var monthExpTotal = 0;
    var todayExpTotal = 0;
    var dayTotals = {};
    var itemCounts = {};

    sales.forEach(function (s) {
        var ms = saleTimestampToMs(s);
        if (ms >= todayMs && ms < tomorrowMs) {
            todaySalesTotal += s.total || 0;
            todayOrderCount++;
        }
        if (ms >= startMs && ms < endMs) {
            monthlyTotal += s.total || 0;
            var dayKey = new Date(ms).getDate();
            dayTotals[dayKey] = (dayTotals[dayKey] || 0) + (s.total || 0);
            if (s.items) {
                s.items.forEach(function (it) {
                    var itemName = it.name || it['name_' + lang] || it.name_en || '—';
                    var qty = it.quantity || 1;
                    if (!itemCounts[itemName]) itemCounts[itemName] = 0;
                    itemCounts[itemName] += qty;
                });
            }
        }
    });

    expenses.forEach(function (e) {
        if (isExpenseOnLocalDay(e, today)) todayExpTotal += e.price || 0;
        if (isExpenseInMonth(e, month, year)) monthExpTotal += e.price || 0;
    });

    var labelEl = document.getElementById('dailySalesMonthLabel');
    if (labelEl) labelEl.textContent = getMonthName(month, S);

    var elToday = document.getElementById('todaySales');
    if (elToday) elToday.textContent = todaySalesTotal.toLocaleString() + ' IQD';
    var elOrders = document.getElementById('todayOrders');
    if (elOrders) elOrders.textContent = todayOrderCount.toString();
    var elTodayExp = document.getElementById('todayExpenses');
    if (elTodayExp) elTodayExp.textContent = todayExpTotal.toLocaleString() + ' IQD';
    var elTodayNet = document.getElementById('todayNet');
    if (elTodayNet) elTodayNet.textContent = (todaySalesTotal - todayExpTotal).toLocaleString() + ' IQD';
    var elM = document.getElementById('monthlySales');
    if (elM) elM.textContent = monthlyTotal.toLocaleString() + ' IQD';
    var elMExp = document.getElementById('monthlyExpenses');
    if (elMExp) elMExp.textContent = monthExpTotal.toLocaleString() + ' IQD';
    var elMNet = document.getElementById('monthlyNet');
    if (elMNet) elMNet.textContent = (monthlyTotal - monthExpTotal).toLocaleString() + ' IQD';

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
}

function renderRecentSalesUI() {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var container = document.getElementById('recentSalesContainer');
    if (!container) return;

    var rows = getSalesDataSource().slice().sort(function (a, b) {
        return saleTimestampToMs(b) - saleTimestampToMs(a);
    }).slice(0, 5);

    if (rows.length === 0) {
        container.innerHTML = '<p style="color:#888;padding:16px;">' + S.noSalesYet + '</p>';
        return;
    }
    renderRecentSalesTable(rows, S, container);
}

function paintDashboardFromCache(month) {
    renderDashboardUI(month);
}

function stopDashboardListeners() {
    dashboardUnsubscribes.forEach(function (unsub) {
        try { unsub(); } catch (e) { /* ignore */ }
    });
    dashboardUnsubscribes = [];
    _adminLiveListenersStarted = false;
    _adminSalesLive = null;
    _adminExpensesLive = null;
}

function startDashboardListeners(month) {
    startAdminLiveListeners();
    renderDashboardUI(month);
}

function loadDashboardStats(month) {
    renderDashboardUI(month);
}

function loadRecentSales() {
    renderRecentSalesUI();
}

function renderRecentSalesTable(sales, S, container) {
    var html = '<div class="table-responsive"><table class="admin-table"><thead><tr><th>' + S.time + '</th><th>' + S.items + '</th><th>' + S.total + ' (IQD)</th></tr></thead><tbody>';
    sales.forEach(function (sale) {
        var cnt = sale.items ? sale.items.reduce(function (s, i) { return s + (i.quantity || 1); }, 0) : 0;
        var tsMs = saleTimestampToMs(sale);
        var timeStr = tsMs ? toDisplayTime(new Date(tsMs)) : '—';
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
                    '<form id="itemForm" novalidate>' +
                        '<div class="form-group"><label>' + S.kurdishName + '</label><input type="text" id="itemNameKu" autocomplete="off"></div>' +
                        '<div class="form-group"><label>' + S.arabicName + '</label><input type="text" id="itemNameAr" autocomplete="off"></div>' +
                        '<div class="form-group"><label>' + S.englishName + '</label><input type="text" id="itemNameEn" autocomplete="off"></div>' +
                        '<div class="form-group"><label>' + S.kurdishDesc + '</label><textarea id="itemDescKu" rows="2"></textarea></div>' +
                        '<div class="form-group"><label>' + S.arabicDesc + '</label><textarea id="itemDescAr" rows="2"></textarea></div>' +
                        '<div class="form-group"><label>' + S.englishDesc + '</label><textarea id="itemDescEn" rows="2"></textarea></div>' +
                        '<div class="form-group"><label>' + S.imageURL + '</label>' +
                            '<input type="file" accept="image/*" id="itemImageFile" style="margin-bottom:6px;">' +
                            '<input type="text" id="itemImageURL" placeholder="' + (S.imageUrlOrUpload || 'Paste image URL or upload above') + '">' +
                            '<img id="itemImagePreview" style="display:none;margin-top:8px;max-height:120px;border-radius:8px;"></div>' +
                        '<div class="form-group"><label>' + S.price + '</label><input type="text" inputmode="decimal" id="itemPrice" autocomplete="off"></div>' +
                         '<div class="form-group"><label>' + S.category + '</label>' +
                             '<div style="display:flex;gap:8px;">' +
                                 '<select id="itemCategory" style="flex:1;">' +
                                     '<option value="">' + S.select + '</option>' +
                                 '</select>' +
                                 '<button type="button" class="btn-primary" id="addNewCategoryBtn" style="padding:8px 12px;">+</button>' +
                             '</div></div>' +
                          '<div class="form-group"><label>' + (S.group || 'Group') + '</label>' +
                              '<input type="text" id="itemGroupKu" placeholder="' + (S.kurdishName || 'Kurdish') + '">' +
                              '<input type="text" id="itemGroupAr" placeholder="' + (S.arabicName || 'Arabic') + '" style="margin-top:6px;">' +
                              '<input type="text" id="itemGroupEn" placeholder="' + (S.englishName || 'English') + '" style="margin-top:6px;">' +
                          '</div>' +
                        '<div class="form-group"><label><input type="checkbox" id="itemAvailable" checked> ' + S.available + '</label></div>' +
                        '<button type="button" class="btn-primary" id="saveItemBtn">' + S.saveItem + '</button>' +
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

    if (USE_LOCAL_API) {
        localApiRequest('menu_items.php').then(function(items) {
            var docs = items.map(function(item) {
                return {
                    id: item.id,
                    data: function() { return item; }
                };
            });
            _itemsSnapDocs = docs.filter(function(d) { return d.data().category !== 'Water'; });
            refreshCategoryFilterOptions();
            refreshItemCategoryDropdown();
            var searchEl = document.getElementById('itemSearch');
            var catEl = document.getElementById('categoryFilter');
            var searchTerm = searchEl ? searchEl.value : '';
            var cat = catEl ? catEl.value : itemsActiveCategory;
            renderItemsList(filterLocalItemDocs(_itemsSnapDocs, searchTerm, cat));

            var cashierCache = [];
            var menuCache = [];
            _itemsSnapDocs.forEach(function(d) {
                var data = d.data();
                cashierCache.push({ id: d.id, v: data });
                menuCache.push(Object.assign({ id: d.id }, data));
            });
            localStorage.setItem('cachedCashierItems', JSON.stringify(cashierCache));
            writeCachedMenuItemsFlat(menuCache);

            var catNames = {};
            _itemsSnapDocs.forEach(function(d) {
                var c = d.data().category;
                if (c && c !== 'Water') catNames[c] = true;
            });
            localStorage.setItem('cachedMenuCategoryNames', JSON.stringify(Object.keys(catNames)));
        }).catch(function(err) {
            console.warn('[admin items] Local API failed:', err.message);
            if (!hydrateItemsUiFromCache()) {
                clearAdminLoadingEl('itemsList', '<p style="color:#C62828;">' + S.errorPrefix + (S.menuConnectionHint || 'Check connection') + '</p>');
            }
        });
        return;
    }

    if (!window.db) {
        if (!_itemsSnapDocs.length) {
            clearAdminLoadingEl('itemsList', '<p>' + S.noItemsFound + '</p>');
        }
        return;
    }

    function applyItemsSnap(snap) {
        if (snap.empty) {
            if (hydrateItemsUiFromCache()) return;
            if (isFirestoreCacheEmptySnap(snap)) return;
            clearAdminLoadingEl('itemsList', '<p>' + S.noItemsFound + '</p>');
            return;
        }
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
        if (isFirestoreApiDisabledError(e)) {
            showFirestoreApiDisabledAlert();
        }
        if (!hydrateItemsUiFromCache()) {
            clearAdminLoadingEl('itemsList', '<p style="color:#C62828;">' + S.errorPrefix + (S.menuConnectionHint || 'Check connection') + '</p>');
        }
    });

    if (navigator.onLine) {
        fetchMenuItemsForAdmin(12000).then(function (items) {
            if (!items || !items.length) return;
            writeCachedMenuItemsFlat(items);
            hydrateItemsUiFromCache();
            loadCategoryFilter();
        }).catch(function (e) {
            console.warn('[admin items] REST fallback:', e.message || e);
        });
    }

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

    refreshItemCategoryDropdown();

    if (!window.db) return Promise.resolve();

    var restPromise = (typeof fetchCategoriesForAdmin === 'function')
        ? fetchCategoriesForAdmin(12000).then(function (cats) {
            if (cats && cats.length) {
                localStorage.setItem('cachedCategories', JSON.stringify(cats));
                refreshItemCategoryDropdown();
            }
        }).catch(function () {})
        : Promise.resolve();

    var sdkPromise = adminGetWithTimeout(db.collection('categories'), 8000).then(function (snap) {
        var categories = [];
        snap.forEach(function (doc) {
            categories.push({ id: doc.id, data: doc.data() });
        });
        if (categories.length) {
            localStorage.setItem('cachedCategories', JSON.stringify(categories));
            refreshItemCategoryDropdown();
        }
    }).catch(function (e) {
        console.error('Error loading categories:', e);
        refreshItemCategoryDropdown();
    });

    return Promise.all([restPromise, sdkPromise]);
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
        var html = '<div class="table-responsive"><table class="admin-table"><thead><tr><th>Image</th><th>Name</th><th>' + S.category + '</th><th>' + (S.group || 'Group') + '</th><th>' + S.price + '</th><th>' + S.available + '</th><th>Actions</th></tr></thead><tbody>';
        items.forEach(function (doc) {
            var item = doc.data();
            var name = item['name_' + lang] || item.name_ku || item.name_ar || item.name_en || S.unnamed;
            var img = item.image || 'https://placehold.co/50x50?text=No+Image';
            var avail = item.available ? '<span style="color:#2E7D32;">' + S.yes + '</span>' : '<span style="color:#C62828;">' + S.no + '</span>';
            var catName = getCategoryLabel(item.category, lang, catMap);
            var groupName = item.group_ku || item.group_ar || item.group_en || '';
            html += '<tr>' +
                '<td><img src="' + img + '" alt="' + name + '" width="48" height="48"></td>' +
                '<td>' + name + '</td>' +
                '<td>' + catName + '</td>' +
                '<td>' + escapeHtmlText(groupName) + '</td>' +
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
            var saveBtn = document.getElementById('saveItemBtn');
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.textContent = S.saveItem;
            }
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
    function triggerSaveItem() {
        try {
            saveItem();
        } catch (err) {
            console.error('saveItem error:', err);
            alert(S.itemSyncFailed + (err && err.message ? '\n' + err.message : ''));
        }
    }
    if (form) {
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            triggerSaveItem();
        });
    }
    var saveItemBtn = document.getElementById('saveItemBtn');
    if (saveItemBtn) {
        saveItemBtn.addEventListener('click', function (e) {
            e.preventDefault();
            triggerSaveItem();
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
var MENU_SYNC_WRITE = { requireSync: true };

function applyWrite(promise, onDone, onError, options) {
    options = options || {};
    var waitForCloud = options.requireSync === true && navigator.onLine;

    function callDone(isOfflineSave) {
        try {
            if (typeof onDone === 'function') onDone(!!isOfflineSave);
        } catch (e) {
            console.error('UI update error after write:', e);
        }
    }

    if (!promise || typeof promise.then !== 'function') {
        callDone(!navigator.onLine);
        return;
    }

    if (waitForCloud) {
        promise.then(function () {
            callDone(false);
        }).catch(function (err) {
            console.error('Firestore sync error:', err);
            if (typeof onError === 'function') onError(err);
        });
        return;
    }

    callDone(!navigator.onLine);
    promise.catch(function (err) {
        console.error('Firestore sync error (will retry when online):', err);
        if (typeof onError === 'function') onError(err);
    });
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

    var now = new Date().toISOString();
    var plainData = {
        name_ku: nameKu,
        name_ar: nameAr,
        name_en: nameEn,
        image: finalImg,
        created_at: now,
        updated_at: now
    };

    var newCatRef = db.collection('categories').doc();
    applyMenuCloudWrite({
        collection: 'categories',
        docId: newCatRef.id,
        isCreate: true,
        sdkPromise: newCatRef.set(Object.assign({}, plainData, {
            created_at: firebase.firestore.FieldValue.serverTimestamp(),
            updated_at: firebase.firestore.FieldValue.serverTimestamp()
        })),
        plainData: plainData,
        onDone: function (offline) {
            upsertCachedCategory(newCatRef.id, plainData);
            document.getElementById('quickCategoryModal').classList.remove('active');
            loadCategoriesDropdown();
            renderCategoriesListNow();
            var select = document.getElementById('itemCategory');
            if (select) { select.value = newCatRef.id; }
            alert(offline ? S.categorySavedOffline : S.categorySavedCloud);
        },
        onError: function (err) {
            alert(S.itemSyncFailed + (err && err.message ? '\n' + err.message : ''));
        }
    });
}

function saveItem() {
     var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;

     if (!window.db) {
         alert(S.itemSyncFailed + '\nFirebase not ready.');
         return;
     }

     var nameKuEl = document.getElementById('itemNameKu');
     var nameArEl = document.getElementById('itemNameAr');
     var nameEnEl = document.getElementById('itemNameEn');
     var priceEl = document.getElementById('itemPrice');
     var categoryEl = document.getElementById('itemCategory');
     if (!nameKuEl || !nameArEl || !nameEnEl || !priceEl || !categoryEl) {
         alert(S.itemSyncFailed);
         return;
     }

     var nameKu = nameKuEl.value.trim();
    var nameAr = nameArEl.value.trim();
    var nameEn = nameEnEl.value.trim();
    var price = priceEl.value.trim().replace(',', '.');
    var category = categoryEl.value;

    if (!nameKu || !nameAr || !nameEn || !price) {
        alert(S.fillAll);
        return;
    }
    if (!category) {
        alert(S.selectCategory || (S.fillAll + ' (' + S.category + ')'));
        categoryEl.focus();
        return;
    }
    if (isNaN(parseFloat(price))) {
        alert(S.fillAll + ' (' + S.price + ')');
        priceEl.focus();
        return;
    }

    var saveBtn = document.getElementById('saveItemBtn');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.dataset.prevText = saveBtn.textContent;
        saveBtn.textContent = '…';
    }

    var saveTimedOut = false;
    var readyTimer = setTimeout(function () {
        saveTimedOut = true;
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = saveBtn.dataset.prevText || S.saveItem;
        }
        alert(S.itemSyncFailed + '\n' + (S.connectionSlow || 'Connection slow — try again.'));
    }, 12000);

    function runSaveWhenAuthed() {
     if (!isAdminAuthenticated()) {
         clearTimeout(readyTimer);
         if (saveBtn) {
             saveBtn.disabled = false;
             saveBtn.textContent = saveBtn.dataset.prevText || S.saveItem;
         }
         alert(S.itemSyncFailed + '\nPlease log in again.');
         window.location.href = 'login.html';
         return;
     }

    var imgUrl = document.getElementById('itemImageURL').value.trim();
    var placeholderImg = 'data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27400%27 height=%27300%27%3E%3Crect fill=%23e0e0e0 width=%27400%27 height=%27300%27/%3E%3Ctext x=%2750%25%27 y=%2750%25%27 font-size=%2724%27 text-anchor=%27middle%27 dy=%27.3em%27 fill=%23999%27%3ENo+Image%3C/text%3E%3C/svg%3E';
    var finalImg = imgUrl || placeholderImg;

    if (finalImg.length > 950000) {
        clearTimeout(readyTimer);
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = saveBtn.dataset.prevText || S.saveItem;
        }
        alert(S.itemSyncFailed + '\nImage too large — paste a URL or use a smaller photo.');
        return;
    }

    var itemId = document.getElementById('itemId').value;
    var now = new Date().toISOString();
     var plainData = {
         name_ku: nameKu, name_ar: nameAr, name_en: nameEn,
         description_ku: document.getElementById('itemDescKu').value.trim(),
         description_ar: document.getElementById('itemDescAr').value.trim(),
         description_en: document.getElementById('itemDescEn').value.trim(),
         price: parseFloat(price) || 0,
         category: category,
         group_ku: (document.getElementById('itemGroupKu') || {}).value || '',
         group_ar: (document.getElementById('itemGroupAr') || {}).value || '',
         group_en: (document.getElementById('itemGroupEn') || {}).value || '',
         image: finalImg,
         available: document.getElementById('itemAvailable').checked,
         updated_at: now
     };

    var ref;
    var promise;
    var docId;
    var isCreate = !itemId;
    if (itemId) {
        docId = itemId;
        ref = db.collection('menuItems').doc(itemId);
        promise = ref.update(Object.assign({}, plainData, {
            updated_at: firebase.firestore.FieldValue.serverTimestamp()
        }));
    } else {
        ref = db.collection('menuItems').doc();
        docId = ref.id;
        plainData.created_at = now;
        promise = ref.set(Object.assign({}, plainData, {
            created_at: firebase.firestore.FieldValue.serverTimestamp(),
            updated_at: firebase.firestore.FieldValue.serverTimestamp()
        }));
    }

    function finishSave(offline) {
        clearTimeout(readyTimer);
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = saveBtn.dataset.prevText || S.saveItem;
        }
        upsertCachedMenuItem(docId, plainData);
        document.getElementById('itemModal').classList.remove('active');
        activeItemModal = null;
        hydrateItemsUiFromCache();
        alert(offline ? S.itemSavedOffline : S.itemSavedCloud);
    }

    function failSave(err) {
        clearTimeout(readyTimer);
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = saveBtn.dataset.prevText || S.saveItem;
        }
        alert(S.itemSyncFailed + (err && err.message ? '\n' + err.message : ''));
    }

    applyMenuCloudWrite({
        collection: 'menuItems',
        docId: docId,
        isCreate: isCreate,
        sdkPromise: promise,
        plainData: plainData,
        onDone: finishSave,
        onError: failSave
    });
    }

    whenAdminReady(function () {
        if (saveTimedOut) return;
        clearTimeout(readyTimer);
        runSaveWhenAuthed();
    }).catch(function (err) {
        clearTimeout(readyTimer);
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = saveBtn.dataset.prevText || S.saveItem;
        }
        alert(S.itemSyncFailed + (err && err.message ? '\n' + err.message : ''));
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
        var groupEl = document.getElementById('itemGroupKu');
        if (groupEl) groupEl.value = item.group_ku || '';
        groupEl = document.getElementById('itemGroupAr');
        if (groupEl) groupEl.value = item.group_ar || '';
        groupEl = document.getElementById('itemGroupEn');
        if (groupEl) groupEl.value = item.group_en || '';
        if (item.image) {
            document.getElementById('itemImageURL').value = item.image;
            var pr = document.getElementById('itemImagePreview');
            if (pr) { pr.src = item.image; pr.style.display = 'block'; }
        }
        document.getElementById('modalTitle').textContent = S.editItem;
        var saveBtn = document.getElementById('saveItemBtn');
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = S.saveItem;
        }
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
    if (!isAdminAuthenticated()) {
        alert(S.itemSyncFailed + '\nPlease log in again.');
        return;
    }
    applyMenuCloudWrite({
        collection: 'menuItems',
        docId: itemId,
        isDelete: true,
        sdkPromise: db.collection('menuItems').doc(itemId).delete(),
        onDone: function () {
            removeCachedMenuItem(itemId);
            hydrateItemsUiFromCache();
        },
        onError: function (err) {
            alert(S.itemSyncFailed + (err && err.message ? '\n' + err.message : ''));
        }
    });
}

/* ============ CATEGORIES ============ */

function mergeCategoryLists(serverCats, cachedCats) {
    if (serverCats && serverCats.length) {
        return serverCats.filter(function (c) { return c && c.id; });
    }
    return (cachedCats || []).filter(function (c) { return c && c.id; });
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

    if (USE_LOCAL_API) {
        localApiRequest('categories.php').then(function(cats) {
            var merged = mergeCategoryLists(cats.map(function(c) { return { id: c.id, data: c }; }), readCachedCategories());
            localStorage.setItem('cachedCategories', JSON.stringify(merged));
            var have = {};
            merged.forEach(function(c) { have[c.id] = true; });
            renderCategoriesTable(mergeMenuCategories(merged, have));

            // Also update menu category names from items
            localApiRequest('menu_items.php').then(function(items) {
                var names = {};
                items.forEach(function(it) { if (it.category) names[it.category] = true; });
                localStorage.setItem('cachedMenuCategoryNames', JSON.stringify(Object.keys(names)));
                renderCategoriesListNow();
            }).catch(function() {});
        }).catch(function(err) {
            console.warn('[admin categories] Local API failed:', err.message);
            renderCategoriesListNow();
        });
        return;
    }

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
    }).catch(function (err) {
        if (isFirestoreApiDisabledError(err)) {
            showFirestoreApiDisabledAlert();
        }
        renderCategoriesListNow();
    });

    if (navigator.onLine) {
        fetchCategoriesForAdmin(12000).then(function (cats) {
            if (!cats || !cats.length) return;
            var merged = mergeCategoryLists(cats, readCachedCategories());
            localStorage.setItem('cachedCategories', JSON.stringify(merged));
            renderCategoriesListNow();
        }).catch(function (e) {
            console.warn('[admin categories] REST fallback:', e.message || e);
        });
    }

    adminGetWithTimeout(db.collection('menuItems'), 8000).then(function (snap) {
        var names = {};
        snap.forEach(function (d) { var c = (d.data() || {}).category; if (c) names[c] = true; });
        localStorage.setItem('cachedMenuCategoryNames', JSON.stringify(Object.keys(names)));
        renderCategoriesListNow();
    }).catch(function () {});

    stopCategoriesListener();
    categoriesUnsubscribe = db.collection('categories').onSnapshot(function (snap) {
        if (snap.empty) {
            if (isFirestoreCacheEmptySnap(snap)) {
                renderCategoriesListNow();
                return;
            }
            var merged = mergeCategoryLists([], readCachedCategories());
            localStorage.setItem('cachedCategories', JSON.stringify(merged));
            var haveEmpty = {};
            merged.forEach(function (c) { haveEmpty[c.id] = true; });
            renderCategoriesTable(mergeMenuCategories(merged, haveEmpty));
            return;
        }
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
            applyWrite(batch.commit(), function (offline) {
                loadCategoriesList();
                alert((offline ? S.categorySavedOffline : (S.categoriesSynced || 'Categories added:')) + ' ' + count);
            }, function (err) {
                alert(S.itemSyncFailed + (err && err.message ? '\n' + err.message : ''));
            }, MENU_SYNC_WRITE);
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

    var categoryId = document.getElementById('categoryId').value.trim();
    var isCreate = !categoryId;
    if (isCreate) {
        categoryId = nameEn || nameKu || nameAr;
    }
    var now = new Date().toISOString();
    var plainData = {
        name_ku: nameKu,
        name_ar: nameAr,
        name_en: nameEn,
        image: finalImg,
        updated_at: now
    };

    var promise;
    var savedId = categoryId;
    if (categoryId) {
        var catRef = db.collection('categories').doc(categoryId);
        if (isCreate) {
            plainData.created_at = now;
        }
        var writeData = Object.assign({}, plainData, {
            created_at: firebase.firestore.FieldValue.serverTimestamp(),
            updated_at: firebase.firestore.FieldValue.serverTimestamp()
        });
        promise = catRef.set(writeData, { merge: true });
    } else {
        var newRef = db.collection('categories').doc();
        savedId = newRef.id;
        plainData.created_at = now;
        promise = newRef.set(Object.assign({}, plainData, {
            created_at: firebase.firestore.FieldValue.serverTimestamp(),
            updated_at: firebase.firestore.FieldValue.serverTimestamp()
        }));
    }

    applyMenuCloudWrite({
        collection: 'categories',
        docId: savedId,
        isCreate: isCreate,
        sdkPromise: promise,
        plainData: plainData,
        onDone: function (offline) {
            upsertCachedCategory(savedId, plainData);
            document.getElementById('categoryModal').classList.remove('active');
            loadCategoriesDropdown();
            refreshCategoriesCache(function () {
                renderCategoriesListNow();
            });
            alert(offline ? S.categorySavedOffline : S.categorySavedCloud);
        },
        onError: function (err) {
            alert(S.itemSyncFailed + (err && err.message ? '\n' + err.message : ''));
        }
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

    var isVirtual = !readCachedCategories().some(function (c) { return c.id === categoryId; });

    if (isVirtual) {
        removeCategoryFromCacheAndUi(categoryId);
        alert((S.categoryDeleted || 'Category removed locally: ') + categoryId);
        return;
    }

    if (!window.db) {
        alert(S.itemSyncFailed + '\nFirebase not ready.');
        return;
    }

    firestoreGetWithTimeout(db.collection('menuItems').where('category', '==', categoryId), 8000).then(function (snap) {
        var batch = db.batch();
        snap.forEach(function (doc) {
            batch.delete(doc.ref);
        });

        batch.delete(db.collection('categories').doc(categoryId));

        applyWrite(batch.commit(), function () {
            removeCategoryFromCacheAndUi(categoryId);
            loadCategoriesList();
        }, function (err) {
            alert(S.itemSyncFailed + (err && err.message ? '\n' + err.message : ''));
        }, MENU_SYNC_WRITE);
    }).catch(function (e) {
        alert(S.errorPrefix + e.message);
    });
}

function removeCategoryFromCacheAndUi(categoryId) {
    var cats = readCachedCategories().filter(function (c) { return c.id !== categoryId; });
    localStorage.setItem('cachedCategories', JSON.stringify(cats));

    try {
        var names = JSON.parse(localStorage.getItem('cachedMenuCategoryNames') || '[]');
        var filtered = names.filter(function (n) { return n !== categoryId; });
        localStorage.setItem('cachedMenuCategoryNames', JSON.stringify(filtered));
    } catch (e) {}

    renderCategoriesListNow();
    refreshItemCategoryDropdown();
    refreshCategoryFilterOptions();
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
    if (window.innerWidth <= 1024) {
        panel.classList.remove('collapsed');
        return;
    }
    var collapsed = false;
    toggle.addEventListener('click', function () {
        collapsed = !collapsed;
        panel.classList.toggle('collapsed', collapsed);
        toggle.textContent = collapsed ? '▼' : '▲';
    });
}

function applyCashierItemsSnap(snap) {
    if (snap.empty) {
        if (getCashierItemsFromLocalStorage().length > 0) {
            loadCashierItemsFromCache();
            return;
        }
        if (isFirestoreCacheEmptySnap(snap)) return;
        showCashierEmptyState();
        return;
    }
    var items = normalizeCashierItems(snap);
    localStorage.setItem('cachedCashierItems', JSON.stringify(items));
    var menuCache = [];
    snap.forEach(function (d) {
        menuCache.push(Object.assign({ id: d.id }, d.data()));
    });
    writeCachedMenuItemsFlat(menuCache);
    refreshCategoriesCache(function () {
        if (items.length > 0) {
            renderCashierProducts(items);
        } else {
            showCashierEmptyState();
        }
    });
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

    adminGetWithTimeout(db.collection('menuItems'), 8000).then(applyCashierItemsSnap).catch(function (e) {
        console.warn('[cashier] get failed:', e.message);
        loadCashierItemsFromCache();
    });

    if (navigator.onLine) {
        fetchMenuItemsForAdmin(12000).then(function (flatItems) {
            if (!flatItems || !flatItems.length) return;
            writeCachedMenuItemsFlat(flatItems);
            var items = flatItems.filter(function (it) {
                return it && it.available !== false && it.category !== 'Water';
            }).map(function (it) {
                var v = Object.assign({}, it);
                var id = v.id;
                delete v.id;
                return { id: id, v: v };
            });
            localStorage.setItem('cachedCashierItems', JSON.stringify(items));
            if (items.length > 0) renderCashierProducts(items);
        }).catch(function (e) {
            console.warn('[cashier] REST fallback:', e.message || e);
        });
    }

    cashierUnsubscribe = db.collection('menuItems').onSnapshot(applyCashierItemsSnap, function (e) {
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
            '<img class="brand-logo" src="' + escapeReceiptHtml(options.logoUrl || 'assets/shawarma demeshq-logo.jpg') + '" alt="" onerror="this.style.display=\'none\'">' +
             '<div class="brand-title"><span class="en">Shawarma</span><span class="sep">|</span><span class="ku">Shawarma</span></div>' +
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

    var logoUrl = new URL('assets/shawarma demeshq-logo.jpg', window.location.href).href;

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
    var menuIndicator = document.getElementById('offlineIndicator');
    if (menuIndicator) menuIndicator.remove();

    window.addEventListener('online', function () {
        console.log('Admin: Back online — syncing data');
        scheduleAdminConnectionStatus(true);
        warmAdminOfflineCache(function () {
            refreshAdminCurrentSection();
        });
    });

    window.addEventListener('offline', function () {
        console.log('Admin: Gone offline');
        scheduleAdminConnectionStatus(false);
        hydrateAdminFromLocalCache();
        refreshAdminCurrentSection();
    });

    if (!navigator.onLine) scheduleAdminConnectionStatus(false);
}

var _adminStatusShowTimer = null;
var _adminStatusHideTimer = null;
var ADMIN_STATUS_DELAY_MS = 2000;
var ADMIN_STATUS_VISIBLE_MS = 3000;

function clearAdminStatusTimers() {
    if (_adminStatusShowTimer) { clearTimeout(_adminStatusShowTimer); _adminStatusShowTimer = null; }
    if (_adminStatusHideTimer) { clearTimeout(_adminStatusHideTimer); _adminStatusHideTimer = null; }
}

function hideAdminConnectionStatus() {
    var existing = document.getElementById('adminOfflineIndicator');
    if (!existing) return;
    existing.style.opacity = '0';
    setTimeout(function () { if (existing.parentNode) existing.remove(); }, 400);
}

function scheduleAdminConnectionStatus(online) {
    clearAdminStatusTimers();
    hideAdminConnectionStatus();
    _adminStatusShowTimer = setTimeout(function () {
        _adminStatusShowTimer = null;
        showAdminConnectionStatusNow(online);
        _adminStatusHideTimer = setTimeout(function () {
            _adminStatusHideTimer = null;
            hideAdminConnectionStatus();
        }, ADMIN_STATUS_VISIBLE_MS);
    }, ADMIN_STATUS_DELAY_MS);
}

function showAdminConnectionStatus(online) {
    scheduleAdminConnectionStatus(online);
}

function showAdminConnectionStatusNow(online) {
    var existing = document.getElementById('adminOfflineIndicator');
    if (existing) existing.remove();

    var lang = localStorage.getItem('selectedLang') || 'ku';
    var S = i18n[lang] || i18n.en;

    var indicator = document.createElement('div');
    indicator.id = 'adminOfflineIndicator';
    indicator.style.cssText = 'position:fixed;top:70px;right:20px;color:#fff;padding:8px 16px;border-radius:20px;font-size:12px;font-weight:600;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.3);display:flex;align-items:center;gap:8px;transition:opacity .4s ease;opacity:0;';

    var dot = document.createElement('span');
    dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#fff;display:inline-block;';
    indicator.appendChild(dot);

    var label = document.createElement('span');
    if (online) {
        indicator.style.background = '#2E7D32';
        label.textContent = (S.backOnline || 'Back online — syncing');
    } else {
        indicator.style.background = '#C62828';
        label.textContent = (S.offlineMode || 'Offline Mode — changes will sync');
    }
    indicator.appendChild(label);
    document.body.appendChild(indicator);
    requestAnimationFrame(function () { indicator.style.opacity = '1'; });
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
    if (allowed.indexOf(accent) === -1) accent = 'sapphire';
    document.documentElement.setAttribute('data-accent', accent);
    try { localStorage.setItem('adminAccent', accent); } catch (e) {}
    var themeMeta = { gold: '#D4AF37', emerald: '#10B981', sapphire: '#3B82F6', amethyst: '#8B5CF6', ruby: '#F43F5E', sunset: '#F97316', rose: '#EC4899', graphite: '#94A3B8', cyan: '#06B6D4' };
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta && themeMeta[accent]) meta.setAttribute('content', themeMeta[accent]);
}
window.applyAdminAccent = applyAdminAccent;

function getCafeTimeMinuteOptions(parts, lang) {
    var opts = [];
    var seen = {};
    for (var m = 0; m < 60; m += 5) {
        var val = String(m).padStart(2, '0');
        opts.push({
            value: val,
            label: typeof toLocaleDigits === 'function' ? toLocaleDigits(val, lang) : val
        });
        seen[m] = true;
    }
    if (!seen[parts.minute]) {
        var customVal = String(parts.minute).padStart(2, '0');
        opts.push({
            value: customVal,
            label: typeof toLocaleDigits === 'function' ? toLocaleDigits(customVal, lang) : customVal
        });
        opts.sort(function (a, b) { return parseInt(a.value, 10) - parseInt(b.value, 10); });
    }
    return opts;
}

function buildCafeTimePickerMarkup(idPrefix, timeValue, fallback, S, lang) {
    var parts = typeof parseCafeTimeParts === 'function'
        ? parseCafeTimeParts(timeValue, fallback)
        : { normalized: fallback, hour12: 2, minute: 0, isPm: idPrefix === 'cafeOpen' };
    var digits = function (n) {
        return typeof toLocaleDigits === 'function' ? toLocaleDigits(String(n), lang) : String(n);
    };
    var hourOpts = '';
    for (var h = 1; h <= 12; h++) {
        hourOpts += '<option value="' + h + '"' + (h === parts.hour12 ? ' selected' : '') + '>' + digits(h) + '</option>';
    }
    var minOpts = '';
    getCafeTimeMinuteOptions(parts, lang).forEach(function (item) {
        minOpts += '<option value="' + item.value + '"' + (parseInt(item.value, 10) === parts.minute ? ' selected' : '') + '>' + item.label + '</option>';
    });
    var periodOpts =
        '<option value="am"' + (!parts.isPm ? ' selected' : '') + '>' + (S.timeAm || 'بەیانی') + '</option>' +
        '<option value="pm"' + (parts.isPm ? ' selected' : '') + '>' + (S.timePm || 'دوای نیوەڕۆ') + '</option>';
    var display = typeof formatCafeTimeForDisplay === 'function'
        ? formatCafeTimeForDisplay(parts.normalized, lang)
        : parts.normalized;

    return '<div class="cafe-time-picker" data-prefix="' + idPrefix + '">' +
        '<button type="button" class="cafe-time-picker-btn" id="' + idPrefix + 'TimeBtn" aria-expanded="false">' +
            '<i class="fa-regular fa-clock" aria-hidden="true"></i>' +
            '<span class="cafe-time-picker-btn-text" id="' + idPrefix + 'TimeLabel">' + display + '</span>' +
            '<i class="fa-solid fa-chevron-down cafe-time-picker-chevron" aria-hidden="true"></i>' +
        '</button>' +
        '<div class="cafe-time-picker-panel" id="' + idPrefix + 'TimePanel" hidden>' +
            '<div class="cafe-time-hourmin">' +
                '<select class="cafe-time-select" id="' + idPrefix + 'Hour" aria-label="hour">' + hourOpts + '</select>' +
                '<span class="cafe-time-colon">:</span>' +
                '<select class="cafe-time-select" id="' + idPrefix + 'Minute" aria-label="minute">' + minOpts + '</select>' +
            '</div>' +
            '<select class="cafe-time-select cafe-time-period" id="' + idPrefix + 'Period" aria-label="period">' + periodOpts + '</select>' +
            '<button type="button" class="btn-secondary cafe-time-apply-btn" id="' + idPrefix + 'TimeApply">' + (S.applyTime || 'Apply') + '</button>' +
        '</div>' +
        '<input type="hidden" id="' + idPrefix + 'Time" value="' + parts.normalized + '">' +
    '</div>';
}

function readCafeTimePickerValue(prefix) {
    var hourEl = document.getElementById(prefix + 'Hour');
    var minEl = document.getElementById(prefix + 'Minute');
    var periodEl = document.getElementById(prefix + 'Period');
    if (!hourEl || !minEl || !periodEl || typeof buildCafeTimeFromParts !== 'function') return null;
    return buildCafeTimeFromParts(hourEl.value, minEl.value, periodEl.value === 'pm');
}

function updateCafeTimePickerDisplay(prefix, lang) {
    var hidden = document.getElementById(prefix + 'Time');
    var label = document.getElementById(prefix + 'TimeLabel');
    if (!hidden) return;
    var fallback = prefix === 'cafeOpen' ? '14:00' : '02:00';
    var normalized = typeof normalizeCafeTimeValue === 'function'
        ? normalizeCafeTimeValue(hidden.value, fallback)
        : hidden.value;
    hidden.value = normalized;
    if (label && typeof formatCafeTimeForDisplay === 'function') {
        label.textContent = formatCafeTimeForDisplay(normalized, lang);
    }
}

function applyCafeTimePicker(prefix, lang) {
    var val = readCafeTimePickerValue(prefix);
    if (!val) return;
    var hidden = document.getElementById(prefix + 'Time');
    if (hidden) hidden.value = val;
    updateCafeTimePickerDisplay(prefix, lang);
    var panel = document.getElementById(prefix + 'TimePanel');
    var btn = document.getElementById(prefix + 'TimeBtn');
    if (panel) {
        panel.hidden = true;
        panel.classList.remove('is-open');
    }
    if (btn) {
        btn.setAttribute('aria-expanded', 'false');
        btn.classList.remove('is-open');
    }
}

function syncCafeTimePickerFromStorage(prefix, lang) {
    var hidden = document.getElementById(prefix + 'Time');
    if (!hidden || typeof parseCafeTimeParts !== 'function') return;
    var storageKey = prefix === 'cafeOpen' ? 'cafeOpenTime' : 'cafeCloseTime';
    var fallback = prefix === 'cafeOpen' ? '14:00' : '02:00';
    var stored = localStorage.getItem(storageKey) || hidden.value;
    var parts = parseCafeTimeParts(stored, fallback);
    hidden.value = parts.normalized;

    var hourEl = document.getElementById(prefix + 'Hour');
    var minEl = document.getElementById(prefix + 'Minute');
    var periodEl = document.getElementById(prefix + 'Period');
    if (hourEl) hourEl.value = String(parts.hour12);
    if (minEl) {
        var minuteVal = String(parts.minute).padStart(2, '0');
        if (!minEl.querySelector('option[value="' + minuteVal + '"]')) {
            var opt = document.createElement('option');
            opt.value = minuteVal;
            opt.textContent = typeof toLocaleDigits === 'function' ? toLocaleDigits(minuteVal, lang) : minuteVal;
            minEl.appendChild(opt);
        }
        minEl.value = minuteVal;
    }
    if (periodEl) periodEl.value = parts.isPm ? 'pm' : 'am';
    updateCafeTimePickerDisplay(prefix, lang);
}

function setupCafeTimePickers(lang) {
    ['cafeOpen', 'cafeClose'].forEach(function (prefix) {
        var btn = document.getElementById(prefix + 'TimeBtn');
        var panel = document.getElementById(prefix + 'TimePanel');
        var applyBtn = document.getElementById(prefix + 'TimeApply');
        if (!btn || !panel) return;
        var pickerEl = btn.closest('.cafe-time-picker');

        function togglePicker(e) {
            if (e.target.closest('.cafe-time-picker-panel')) return;
            e.stopPropagation();
            var willOpen = panel.hidden;
            document.querySelectorAll('.cafe-time-picker-panel').forEach(function (p) {
                p.hidden = true;
                p.classList.remove('is-open');
            });
            document.querySelectorAll('.cafe-time-picker-btn').forEach(function (b) {
                b.setAttribute('aria-expanded', 'false');
                b.classList.remove('is-open');
            });
            if (willOpen) {
                panel.hidden = false;
                panel.classList.add('is-open');
                btn.classList.add('is-open');
            }
            btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
        }

        if (pickerEl) pickerEl.addEventListener('click', togglePicker);
        else btn.addEventListener('click', togglePicker);

        if (applyBtn) {
            applyBtn.addEventListener('click', function () {
                applyCafeTimePicker(prefix, lang);
            });
        }

        ['Hour', 'Minute', 'Period'].forEach(function (part) {
            var el = document.getElementById(prefix + part);
            if (el) {
                el.addEventListener('change', function () {
                    applyCafeTimePicker(prefix, lang);
                });
            }
        });
    });

    if (!window._cafeTimePickerDocClose) {
        window._cafeTimePickerDocClose = true;
        document.addEventListener('click', function (e) {
            if (e.target.closest('.cafe-time-picker')) return;
            document.querySelectorAll('.cafe-time-picker-panel').forEach(function (p) {
                p.hidden = true;
                p.classList.remove('is-open');
            });
            document.querySelectorAll('.cafe-time-picker-btn').forEach(function (b) {
                b.setAttribute('aria-expanded', 'false');
                b.classList.remove('is-open');
            });
        });
    }
}

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
          { id: 'sapphire', color: '#3B82F6', dark: '#1D4ED8' },
          { id: 'gold', color: '#D4AF37', dark: '#B8910C' },
          { id: 'emerald', color: '#10B981', dark: '#047857' },
          { id: 'amethyst', color: '#8B5CF6', dark: '#6D28D9' },
          { id: 'ruby', color: '#F43F5E', dark: '#BE123C' },
          { id: 'sunset', color: '#F97316', dark: '#C2410C' },
          { id: 'rose', color: '#EC4899', dark: '#BE185D' },
          { id: 'cyan', color: '#06B6D4', dark: '#0E7490' },
          { id: 'graphite', color: '#94A3B8', dark: '#475569' }
      ];
      var currentAccent = localStorage.getItem('adminAccent') || 'sapphire';
      var swatchesHtml = themes.map(function (t) {
          var glow = 'rgba(0,0,0,0.25)';
          return '<button type="button" class="theme-swatch' + (t.id === currentAccent ? ' active' : '') + '" data-accent="' + t.id + '" ' +
                 'style="--swatch:' + t.color + ';--swatch-dark:' + t.dark + ';--swatch-glow:' + glow + ';">' +
                 '<span class="theme-swatch-check">✓</span>' +
                 '<span class="theme-swatch-dot"></span>' +
                 '<span class="theme-swatch-name">' + (TL[t.id] || t.id) + '</span>' +
                 '</button>';
      }).join('');

      var settingsLang = localStorage.getItem('selectedLang') || 'ku';
      var openTimeStored = localStorage.getItem('cafeOpenTime') || '14:00';
      var closeTimeStored = localStorage.getItem('cafeCloseTime') || '02:00';

      adminContent.innerHTML =
          '<div class="card settings-contact-card">' +
              '<h2>' + S.settings + '</h2>' +
              '<div class="settings-social-field">' +
                  '<span class="settings-social-icon settings-social-icon--cafe" aria-hidden="true"><i class="fa-solid fa-mug-hot"></i></span>' +
                  '<div class="settings-social-input-wrap">' +
                      '<label for="cafeName">' + S.cafeName + '</label>' +
                      '<input type="text" id="cafeName" value="' + (localStorage.getItem('cafeName') || S.siteName) + '">' +
                  '</div>' +
              '</div>' +
              '<div class="settings-social-field">' +
                  '<span class="settings-social-icon settings-social-icon--contact" aria-hidden="true">' +
                      '<i class="fa-solid fa-phone"></i>' +
                      '<i class="fa-brands fa-whatsapp"></i>' +
                  '</span>' +
                  '<div class="settings-social-input-wrap">' +
                      '<label for="whatsappPhone">' + S.callWhatsAppNumber + '</label>' +
                      '<input type="tel" id="whatsappPhone" value="' + (localStorage.getItem('whatsappPhone') || '9647506454656') + '" placeholder="' + S.phonePlaceholder + '">' +
                  '</div>' +
              '</div>' +
              '<div class="settings-social-field">' +
                  '<span class="settings-social-icon settings-social-icon--maps" aria-hidden="true"><i class="fa-solid fa-map-location-dot"></i></span>' +
                  '<div class="settings-social-input-wrap">' +
                      '<label for="cafeLocationUrl">' + S.locationMapsUrl + '</label>' +
                      '<input type="url" id="cafeLocationUrl" value="' + (localStorage.getItem('cafeLocationUrl') || 'https://maps.app.goo.gl/mmi5iv7mnGKxKZoq9?g_st=ic') + '" placeholder="https://maps.google.com/...">' +
                  '</div>' +
              '</div>' +
              '<div class="settings-social-field">' +
                  '<span class="settings-social-icon settings-social-icon--pin" aria-hidden="true"><i class="fa-solid fa-location-dot"></i></span>' +
                  '<div class="settings-social-input-wrap">' +
                      '<label for="cafeLocationLabel">' + S.locationLabelField + '</label>' +
                      '<input type="text" id="cafeLocationLabel" value="' + (localStorage.getItem('cafeLocationLabel') || 'بەحرکە-مجەمع') + '">' +
                  '</div>' +
              '</div>' +
              '<div class="settings-social-field">' +
                  '<span class="settings-social-icon settings-social-icon--currency" aria-hidden="true">' +
                      '<i class="fa-solid fa-coins"></i>' +
                  '</span>' +
                  '<div class="settings-social-input-wrap">' +
                      '<label for="cafeCurrency">' + S.currency + '</label>' +
                      '<input type="text" id="cafeCurrency" value="IQD" readonly>' +
                  '</div>' +
              '</div>' +
               '<div class="settings-social-field settings-hours-field">' +
                   '<span class="settings-social-icon settings-social-icon--hours" aria-hidden="true"><i class="fa-regular fa-clock"></i></span>' +
                   '<div class="settings-social-input-wrap settings-hours-block">' +
                       '<div class="settings-hours-row">' +
                           '<div class="settings-hours-input">' +
                               '<label>' + S.cafeOpenTimeLabel + '</label>' +
                               '<input type="time" id="cafeOpenTime" class="cafe-time-input" value="' + (typeof normalizeCafeTimeValue === 'function' ? normalizeCafeTimeValue(openTimeStored, '14:00') : openTimeStored) + '">' +
                           '</div>' +
                           '<div class="settings-hours-input">' +
                               '<label>' + S.cafeCloseTimeLabel + '</label>' +
                               '<input type="time" id="cafeCloseTime" class="cafe-time-input" value="' + (typeof normalizeCafeTimeValue === 'function' ? normalizeCafeTimeValue(closeTimeStored, '02:00') : closeTimeStored) + '">' +
                           '</div>' +
                       '</div>' +
                   '</div>' +
               '</div>' +
          '</div>' +
          '<div class="card settings-social-card" style="margin-top:20px;">' +
              '<div class="settings-section-label"><i class="fa-solid fa-share-nodes" aria-hidden="true"></i> ' + S.socialLinks + '</div>' +
              '<div class="settings-section-hint">' + S.socialLinksHint + '</div>' +
              '<div class="settings-social-field">' +
                  '<span class="settings-social-icon settings-social-icon--instagram" aria-hidden="true"><i class="fa-brands fa-instagram"></i></span>' +
                  '<div class="settings-social-input-wrap">' +
                      '<label for="cafeInstagram">' + S.instagramUrl + '</label>' +
                      '<input type="url" id="cafeInstagram" value="' + (localStorage.getItem('cafeInstagram') || '') + '" placeholder="https://instagram.com/...">' +
                  '</div>' +
              '</div>' +
              '<div class="settings-social-field">' +
                  '<span class="settings-social-icon settings-social-icon--tiktok" aria-hidden="true"><i class="fa-brands fa-tiktok"></i></span>' +
                  '<div class="settings-social-input-wrap">' +
                      '<label for="cafeTiktok">' + S.tiktokUrl + '</label>' +
                      '<input type="url" id="cafeTiktok" value="' + (localStorage.getItem('cafeTiktok') || '') + '" placeholder="https://tiktok.com/@...">' +
                  '</div>' +
              '</div>' +
              '<div class="settings-social-field">' +
                  '<span class="settings-social-icon settings-social-icon--snapchat" aria-hidden="true"><i class="fa-brands fa-snapchat"></i></span>' +
                  '<div class="settings-social-input-wrap">' +
                      '<label for="cafeSnapchat">' + S.snapchatUrl + '</label>' +
                      '<input type="url" id="cafeSnapchat" value="' + (localStorage.getItem('cafeSnapchat') || '') + '" placeholder="https://snapchat.com/add/...">' +
                  '</div>' +
              '</div>' +
'<button class="btn-primary" id="saveSettingsBtn" style="margin-top:8px;">' + S.saveSettings + '</button>' +
            '</div>' +
            '<div class="card" style="margin-top:20px;">' +
                '<div class="settings-section-label">🎨 ' + TL.title + '</div>' +
              '<div class="settings-section-hint">' + TL.hint + '</div>' +
              '<div class="theme-picker" id="themePicker">' + swatchesHtml + '</div>' +
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
              var whatsappPhone = typeof normalizeWhatsAppPhone === 'function'
                  ? normalizeWhatsAppPhone(document.getElementById('whatsappPhone').value.trim())
                  : document.getElementById('whatsappPhone').value.trim();
              var cafeLocationUrl = document.getElementById('cafeLocationUrl').value.trim();
              var cafeLocationLabel = document.getElementById('cafeLocationLabel').value.trim();
              var cafeInstagram = typeof normalizeSocialUrl === 'function'
                  ? normalizeSocialUrl(document.getElementById('cafeInstagram').value.trim(), 'instagram')
                  : document.getElementById('cafeInstagram').value.trim();
              var cafeTiktok = typeof normalizeSocialUrl === 'function'
                  ? normalizeSocialUrl(document.getElementById('cafeTiktok').value.trim(), 'tiktok')
                  : document.getElementById('cafeTiktok').value.trim();
              var cafeSnapchat = typeof normalizeSocialUrl === 'function'
                  ? normalizeSocialUrl(document.getElementById('cafeSnapchat').value.trim(), 'snapchat')
                  : document.getElementById('cafeSnapchat').value.trim();
              var openInput = document.getElementById('cafeOpenTime');
              var closeInput = document.getElementById('cafeCloseTime');
              var cafeOpenTime = openInput ? openInput.value.trim() : '';
              var cafeCloseTime = closeInput ? closeInput.value.trim() : '';
              if (!cafeOpenTime) cafeOpenTime = '14:00';
              if (!cafeCloseTime) cafeCloseTime = '02:00';
              if (typeof normalizeCafeTimeValue === 'function') {
                  cafeOpenTime = normalizeCafeTimeValue(cafeOpenTime, '14:00');
                  cafeCloseTime = normalizeCafeTimeValue(cafeCloseTime, '02:00');
              }

              function storeSetting(key, value) {
                  if (value == null || String(value).trim() === '') {
                      localStorage.removeItem(key);
                  } else {
                      localStorage.setItem(key, String(value).trim());
                  }
              }

               storeSetting('cafeName', cafeName);
               storeSetting('whatsappPhone', whatsappPhone);
               storeSetting('cafeLocationUrl', cafeLocationUrl);
storeSetting('cafeLocationLabel', cafeLocationLabel);
            storeSetting('cafeInstagram', cafeInstagram);
            storeSetting('cafeTiktok', cafeTiktok);
            storeSetting('cafeSnapchat', cafeSnapchat);
            storeSetting('cafeOpenTime', cafeOpenTime);
            storeSetting('cafeCloseTime', cafeCloseTime);
            try {
                   localStorage.setItem('cafeSettingsUpdatedAt', String(Date.now()));
               } catch (e) {}

              document.getElementById('whatsappPhone').value = whatsappPhone;
              document.getElementById('cafeInstagram').value = cafeInstagram;
              document.getElementById('cafeTiktok').value = cafeTiktok;
              document.getElementById('cafeSnapchat').value = cafeSnapchat;
              var selectedLang = localStorage.getItem('selectedLang') || 'ku';
               var openHiddenSave = document.getElementById('cafeOpenTime');
               var closeHiddenSave = document.getElementById('cafeCloseTime');
               if (openHiddenSave) openHiddenSave.value = cafeOpenTime;
               if (closeHiddenSave) closeHiddenSave.value = cafeCloseTime;

              var settingsPayload = {
                  cafeName: cafeName,
                  whatsappPhone: whatsappPhone,
                  cafeLocationUrl: cafeLocationUrl,
                  cafeLocationLabel: cafeLocationLabel,
                  cafeInstagram: cafeInstagram,
                  cafeTiktok: cafeTiktok,
                  cafeSnapchat: cafeSnapchat,
                  cafeOpenTime: cafeOpenTime,
                  cafeCloseTime: cafeCloseTime
              };

               if (typeof saveCafeSettingsToFirestore === 'function') {
                    saveCafeSettingsToFirestore(settingsPayload, function (err) {
                        if (err) {
                            var msg = (err && err.message ? String(err.message) : String(err)).toLowerCase();
                            if (msg.indexOf('permission') !== -1 || msg.indexOf('insufficient') !== -1 || msg.indexOf('denied') !== -1) {
                                 alert('⚠️ Settings saved locally only.\n\nFirestore WRITE was DENIED. Fix:\n1) In Firebase Console → project shawarma-demashq-menu → Firestore → Rules tab, paste the rules and click PUBLISH.\n2) Make sure you are logged in as admin.\n\n(' + (err && err.message ? err.message : err) + ')');
                            } else {
                                alert('⚠️ ' + S.settingsSaved + '\n\nCloud sync failed: ' + (err && err.message ? err.message : err) + '\n\nChanges saved locally only.');
                            }
                        } else {
                            alert(S.settingsSaved);
                        }
                    });
                } else {
                    alert(S.settingsSaved);
                }
          });
      }

      if (typeof loadCafeSettingsFromFirestore === 'function') {
          loadCafeSettingsFromFirestore(function () {
              var fields = {
                  cafeName: 'cafeName',
                  whatsappPhone: 'whatsappPhone',
                  cafeLocationUrl: 'cafeLocationUrl',
                  cafeLocationLabel: 'cafeLocationLabel',
                  cafeInstagram: 'cafeInstagram',
                  cafeTiktok: 'cafeTiktok',
                  cafeSnapchat: 'cafeSnapchat'
              };
              Object.keys(fields).forEach(function (storageKey) {
                  var input = document.getElementById(fields[storageKey]);
                  if (!input) return;
                  var value = localStorage.getItem(storageKey) || input.value || '';
                  if (storageKey === 'whatsappPhone' && typeof normalizeWhatsAppPhone === 'function') {
                      value = normalizeWhatsAppPhone(value);
                  }
                  input.value = value;
              });
              var openLoaded = document.getElementById('cafeOpenTime');
              var closeLoaded = document.getElementById('cafeCloseTime');
              if (openLoaded) openLoaded.value = (typeof normalizeCafeTimeValue === 'function' ? normalizeCafeTimeValue(localStorage.getItem('cafeOpenTime') || '14:00', '14:00') : (localStorage.getItem('cafeOpenTime') || '14:00'));
              if (closeLoaded) closeLoaded.value = (typeof normalizeCafeTimeValue === 'function' ? normalizeCafeTimeValue(localStorage.getItem('cafeCloseTime') || '02:00', '02:00') : (localStorage.getItem('cafeCloseTime') || '02:00'));
          });
      }

 }


 /* ============ EXPENSES ============ */

 function readCachedExpenses() {
     try {
         return JSON.parse(localStorage.getItem('cachedExpenses') || '[]').map(normalizeExpenseEntry);
     } catch (e) {
         return [];
     }
 }

 function writeCachedExpenses(items) {
     localStorage.setItem('cachedExpenses', JSON.stringify(items));
     syncExpensesLiveFromCache();
 }

 function expenseTimestampToMs(item) {
     if (!item) return 0;
     var sec = deriveExpenseTimestampSeconds(item);
     if (sec != null) return sec * 1000;
     return 0;
 }

 function expenseEntryFromDoc(doc) {
     var exp = doc.data();
     var ts = exp.timestamp;
     var timestampSeconds = null;
     if (ts && ts.seconds != null) timestampSeconds = ts.seconds;
     else if (ts && ts._seconds != null) timestampSeconds = ts._seconds;
     else if (ts && typeof ts.toDate === 'function') timestampSeconds = Math.floor(ts.toDate().getTime() / 1000);
     return normalizeExpenseEntry({
         id: doc.id,
         name: exp.name,
         price: exp.price || 0,
         date: exp.date,
         time: exp.time,
         timestamp: ts,
         timestampSeconds: timestampSeconds
     });
 }

 function getExpenseMonthRange(month) {
     var year = new Date().getFullYear();
     return {
         start: new Date(year, month, 1),
         end: new Date(year, month + 1, 1)
     };
 }

 function filterExpensesByMonth(items, month) {
     var year = new Date().getFullYear();
     return items.filter(function (item) {
         return isExpenseInMonth(item, month, year);
     }).sort(function (a, b) {
         return expenseTimestampToMs(b) - expenseTimestampToMs(a);
     });
 }

 function filterExpensesByDay(items, dayStart) {
     return items.filter(function (item) {
         return isExpenseOnLocalDay(item, dayStart);
     }).sort(function (a, b) {
         return expenseTimestampToMs(b) - expenseTimestampToMs(a);
     });
 }

 function upsertCachedExpense(entry) {
     normalizeExpenseEntry(entry);
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

     var now = new Date();
     var isCurrentMonth = month === now.getMonth() && now.getFullYear() === new Date().getFullYear();
     var todayStart = new Date();
     todayStart.setHours(0, 0, 0, 0);
     var todayItems = isCurrentMonth ? filterExpensesByDay(items, todayStart) : [];
     var todayIds = {};
     todayItems.forEach(function (e) { todayIds[e.id] = true; });
     var monthRest = isCurrentMonth ? items.filter(function (e) { return !todayIds[e.id]; }) : items;

     function buildRows(listItems) {
         var total = 0;
         var rows = '';
         listItems.forEach(function (item) {
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
                     '<button type="button" class="btn-primary btn-sm edit-expense" data-id="' + item.id + '" title="' + S.edit + '">✎</button> ' +
                     '<button type="button" class="btn-danger btn-sm delete-expense" data-id="' + item.id + '">✕</button>' +
                 '</td>' +
             '</tr>';
         });
         return { rows: rows, total: total };
     }

     function buildTable(title, listItems) {
         if (!listItems.length) return '';
         var built = buildRows(listItems);
         return (title ? '<h3 class="expenses-day-heading">' + title + '</h3>' : '') +
             '<div class="expenses-table-wrapper">' +
             '<table class="expenses-table">' +
                 '<thead><tr>' +
                     '<th>' + S.expenseName + '</th>' +
                     '<th>' + S.expensePrice + '</th>' +
                     '<th>' + S.expenseDate + '</th>' +
                     '<th></th>' +
                 '</tr></thead>' +
                 '<tbody>' + built.rows + '</tbody>' +
                 '<tfoot><tr>' +
                     '<td colspan="4" class="expense-total-cell">' +
                         '<span class="expense-total-label">' + S.totalExpenses + ':</span>' +
                         '<span class="expense-total-value">' + built.total.toLocaleString() + ' IQD</span>' +
                     '</td>' +
                 '</tr></tfoot>' +
             '</table></div>';
     }

     var html = '';
     if (todayItems.length) {
         html += buildTable(S.todayExpenses, todayItems);
     }
     if (monthRest.length) {
         html += buildTable(todayItems.length ? (S.monthlyExpenses || S.expenses) : '', monthRest);
     }
     if (!html) {
         list.innerHTML = '<div class="expenses-empty">' +
             '<div class="expenses-empty-icon">📭</div>' +
             '<p>' + S.noExpenses + '</p>' +
         '</div>';
         return;
     }

     list.innerHTML = html;

     list.querySelectorAll('.edit-expense').forEach(function (btn) {
         btn.addEventListener('click', function () {
             editExpense(this.getAttribute('data-id'));
         });
     });
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
                 '<div id="expensesList"></div>' +
             '</div>' +
         '</div>' +
         '<div id="expenseModal" class="modal-overlay">' +
             '<div class="modal expense-modal">' +
                 '<div class="modal-content">' +
                     '<span class="modal-close" id="expenseModalClose">&times;</span>' +
                     '<h2 id="expenseModalTitle">' + S.addExpense + '</h2>' +
                     '<form id="expenseForm" novalidate>' +
                         '<div class="form-group">' +
                             '<label>' + S.expenseName + '</label>' +
                             '<input type="text" id="expenseName" list="expenseSuggestions" autocomplete="off">' +
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
                                 '<input type="text" inputmode="decimal" id="expensePrice" min="0" autocomplete="off">' +
                             '</div>' +
                             '<div class="form-group">' +
                                 '<label>' + S.expenseDate + '</label>' +
                                 '<input type="date" id="expenseDate">' +
                             '</div>' +
                         '</div>' +
                         '<div class="form-group">' +
                             '<label>' + S.expenseTime + '</label>' +
                             '<input type="time" id="expenseTime">' +
                         '</div>' +
                         '<button type="button" class="btn-primary" id="saveExpenseBtn">' + S.saveItem + '</button>' +
                         '<button type="button" class="btn-secondary" id="cancelExpenseBtn" style="margin-left:8px;">' + S.cancel + '</button>' +
                         '<input type="hidden" id="expenseId" value="">' +
                     '</form>' +
                 '</div>' +
             '</div>' +
         '</div>';

     var monthSelect = document.getElementById('expensesMonthSelect');
     if (monthSelect) {
         monthSelect.addEventListener('change', function () {
             renderExpensesUI(parseInt(this.value, 10));
         });
     }

     var addBtn = document.getElementById('addExpenseBtn');
     if (addBtn) {
         addBtn.addEventListener('click', function () {
             document.getElementById('expenseModalTitle').textContent = S.addExpense;
             document.getElementById('expenseForm').reset();
             document.getElementById('expenseId').value = '';
             var today = getLocalDateKey(new Date());
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
     function triggerSaveExpense() {
         try { saveExpense(); } catch (err) {
             console.error('saveExpense error:', err);
             alert(S.itemSyncFailed + (err && err.message ? '\n' + err.message : ''));
         }
     }
     if (form) {
         form.addEventListener('submit', function (e) {
             e.preventDefault();
             triggerSaveExpense();
         });
     }
     var saveExpenseBtn = document.getElementById('saveExpenseBtn');
     if (saveExpenseBtn) {
         saveExpenseBtn.addEventListener('click', function (e) {
             e.preventDefault();
             triggerSaveExpense();
         });
     }

     renderExpensesUI(currentMonth);
     startAdminLiveListeners();
 }

 function renderExpensesUI(month) {
     if (month === undefined || month === null) month = new Date().getMonth();
     var year = new Date().getFullYear();
     var today = new Date();
     today.setHours(0, 0, 0, 0);
     var tomorrow = new Date(today);
     tomorrow.setDate(tomorrow.getDate() + 1);
     var mStart = new Date(year, month, 1);
     var mEnd = new Date(year, month + 1, 1);
     var todayMs = today.getTime();
     var tomorrowMs = tomorrow.getTime();
     var startMs = mStart.getTime();
     var endMs = mEnd.getTime();

     var all = readCachedExpenses();
     var monthItems = filterExpensesByMonth(all, month);
     var todayTotal = 0;
     var monthTotal = 0;
     all.forEach(function (e) {
         if (isExpenseOnLocalDay(e, today)) todayTotal += e.price || 0;
         if (isExpenseInMonth(e, month, year)) monthTotal += e.price || 0;
     });

     var el = document.getElementById('expTodayTotal');
     if (el) el.textContent = todayTotal.toLocaleString() + ' IQD';
     var elM = document.getElementById('expMonthTotal');
     if (elM) elM.textContent = monthTotal.toLocaleString() + ' IQD';
     var elC = document.getElementById('expCount');
     if (elC) elC.textContent = monthItems.length.toString();

     renderExpensesList(month, monthItems);
 }

 function loadExpensesStats(month) {
     renderExpensesUI(month);
 }

 function loadExpensesList(month) {
     renderExpensesUI(month);
 }

 function editExpense(expenseId) {
     var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
     var expense = readCachedExpenses().filter(function (e) { return e.id === expenseId; })[0];
     if (!expense) return;

     document.getElementById('expenseModalTitle').textContent = S.editExpense || S.editItem;
     document.getElementById('expenseId').value = expense.id;
     document.getElementById('expenseName').value = expense.name || '';
     document.getElementById('expensePrice').value = expense.price != null ? expense.price : '';

     var dateVal = expense.date || '';
     var timeVal = expense.time || '';
     if (!dateVal || !timeVal) {
         var ms = expenseTimestampToMs(expense);
         if (ms) {
             var d = new Date(ms);
             dateVal = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
             timeVal = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
         }
     }
     document.getElementById('expenseDate').value = dateVal;
     document.getElementById('expenseTime').value = timeVal;
     document.getElementById('expenseModal').classList.add('active');
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
     syncExpensesLiveFromCache();

     document.getElementById('expenseModal').classList.remove('active');
     renderExpensesUI(expenseMonth);
     if (document.getElementById('todaySales')) renderDashboardUI(getDashboardMonth());

     if (!window.db) {
         alert(S.expenseSavedOffline || S.expenseSaved);
         return;
     }

     var expenseData = {
         name: name,
         price: parseFloat(price) || 0,
         date: date,
         time: time,
         timestamp: firebase.firestore.Timestamp.fromDate(dateTime),
         updated_at: firebase.firestore.FieldValue.serverTimestamp()
     };

     var isLocalId = expenseId && String(expenseId).indexOf('local-') === 0;
     var isServerUpdate = expenseId && !isLocalId;

     if (!isServerUpdate) {
         expenseData.created_at = firebase.firestore.FieldValue.serverTimestamp();
     }

     var promise;
     if (isServerUpdate) {
         promise = db.collection('expenses').doc(expenseId).update(expenseData);
     } else {
         promise = db.collection('expenses').add(expenseData);
     }

     applyWrite(promise, function (offline) {
         alert(offline ? (S.expenseSavedOffline || S.expenseSaved) : S.expenseSaved);
     });

     if (promise && typeof promise.then === 'function') {
         promise.then(function (ref) {
             if (!isServerUpdate && ref && ref.id) {
                 if (isLocalId) removeCachedExpense(expenseId);
                 else if (!expenseId) removeCachedExpense(tempId);
                 upsertCachedExpense(Object.assign({}, cacheEntry, { id: ref.id }));
                 syncExpensesLiveFromCache();
             }
             renderExpensesUI(expenseMonth);
             if (document.getElementById('todaySales')) renderDashboardUI(getDashboardMonth());
         }).catch(function (err) {
             console.error('Expense save sync error:', err);
         });
     }
 }

 function deleteExpense(expenseId) {
     var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
     if (!confirm(S.deleteExpenseConfirm)) return;

     removeCachedExpense(expenseId);
     syncExpensesLiveFromCache();
     var monthSelect = document.getElementById('expensesMonthSelect');
     var month = monthSelect ? parseInt(monthSelect.value, 10) : new Date().getMonth();
     renderExpensesUI(month);
     if (document.getElementById('todaySales')) renderDashboardUI(getDashboardMonth());

     if (!window.db || String(expenseId).indexOf('local-') === 0) {
         alert(S.expenseDeleted);
         return;
     }

     applyWrite(db.collection('expenses').doc(expenseId).delete(), function (offline) {
         alert(offline ? (S.expenseDeletedOffline || S.expenseDeleted) : S.expenseDeleted);
     });
 }

 /* ============ LOGOUT ============ */

function handleLogout() {
    stopDashboardListeners();
    if (USE_LOCAL_API) {
        localStorage.removeItem('adminAuthToken');
        localStorage.removeItem('adminUser');
        window.currentAuthToken = null;
        window.currentUser = null;
        window.location.href = 'login.html';
        return;
    }
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
