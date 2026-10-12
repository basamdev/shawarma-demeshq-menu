// js/menu-data.js - Optimized shared data layer
// Uses onSnapshot as the primary source with a get() timeout fallback.
// Caches items and categories in memory so filtering is instant and
// menu.html / admin.html only read Firestore once per page load.
(function () {
    'use strict';

    var urlParams = new URLSearchParams(window.location.search || '');
    var urlBranch = urlParams.get('branch');
    if (urlBranch) {
        try {
            localStorage.setItem('current_branch', urlBranch);
            localStorage.setItem('selectedBranch', urlBranch);
        } catch (e) {}
    }
    var storedBranch = null;
    try {
        storedBranch = localStorage.getItem('current_branch') || localStorage.getItem('selectedBranch');
    } catch (e) {}
    var currentBranch = urlBranch || window.CURRENT_BRANCH || storedBranch || '1';
    window.CURRENT_BRANCH = currentBranch;
    var menuCollection = (currentBranch === '2' ? 'menuItems_branch2' : 'menuItems');
    window.MENU_COLLECTION = menuCollection;
    var catCollection = (currentBranch === '2' ? 'categories_branch2' : 'categories');
    window.CAT_COLLECTION = catCollection;

    var _items = [];
    var _categories = [];
    var _itemsUnsub = null;
    var _categoriesUnsub = null;

    function getMenuCollectionName() {
        return window.MENU_COLLECTION || (window.CURRENT_BRANCH === '2' ? 'menuItems_branch2' : 'menuItems');
    }

    function getCatCollectionName() {
        return window.CAT_COLLECTION || (window.CURRENT_BRANCH === '2' ? 'categories_branch2' : 'categories');
    }

    function collectItemDocs(snap) {
        var docs = [];
        snap.forEach(function (d) {
            var data = d.data();
            if (data.category && data.category.toLowerCase().trim() === 'water') return;
            var obj = { id: d.id };
            for (var key in data) { obj[key] = data[key]; }
            docs.push(obj);
        });
        return docs;
    }

    function loadItems(timeoutMs, onUpdate, onError) {
        if (_itemsUnsub) { _itemsUnsub(); _itemsUnsub = null; }
        if (!window.db) { onError(new Error('No DB')); return; }

        var targetCollection = getMenuCollectionName();

        // Use shorter timeout for faster loading
        var isMobile = window.innerWidth <= 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        var defaultTimeout = isMobile ? 4000 : 2000;

        var timer = setTimeout(function () {
            window.db.collection(targetCollection).get({ source: 'server' })
                .then(function (snap) {
                    _items.length = 0;
                    _items.push.apply(_items, collectItemDocs(snap));
                    onUpdate(_items.slice());
                })
                .catch(function () {
                    window.db.collection(targetCollection).get()
                        .then(function (snap) {
                            _items.length = 0;
                            _items.push.apply(_items, collectItemDocs(snap));
                            onUpdate(_items.slice());
                        })
                        .catch(onError);
                });
        }, timeoutMs || defaultTimeout);

        _itemsUnsub = window.db.collection(targetCollection).onSnapshot(
            function (snap) {
                if (!snap.metadata.fromCache && snap.size > 0) {
                    clearTimeout(timer);
                }
                _items.length = 0;
                _items.push.apply(_items, collectItemDocs(snap));
                onUpdate(_items.slice());
            },
            function (err) {
                console.warn('[menu-data] items error:', err.message);
                onError(err);
            }
        );
    }

    function loadCategories(timeoutMs, onUpdate, onError) {
        if (_categoriesUnsub) { _categoriesUnsub(); _categoriesUnsub = null; }
        if (!window.db) { onError(new Error('No DB')); return; }

        var targetCollection = getCatCollectionName();

        // Use shorter timeout for faster loading
        var isMobile = window.innerWidth <= 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        var defaultTimeout = isMobile ? 4000 : 2000;

        var timer = setTimeout(function () {
            window.db.collection(targetCollection).orderBy('order', 'asc').get({ source: 'server' })
                .then(function (snap) {
                    _categories.length = 0;
                    snap.forEach(function (doc) {
                        _categories.push({ id: doc.id, data: doc.data() });
                    });
                    onUpdate(_categories.slice());
                })
                .catch(function () {
                    window.db.collection(targetCollection).orderBy('order', 'asc').get()
                        .then(function (snap) {
                            _categories.length = 0;
                            snap.forEach(function (doc) {
                                _categories.push({ id: doc.id, data: doc.data() });
                            });
                            onUpdate(_categories.slice());
                        })
                        .catch(onError);
                });
        }, timeoutMs || defaultTimeout);

        _categoriesUnsub = window.db.collection(targetCollection).orderBy('order', 'asc').onSnapshot(
            function (snap) {
                if (!snap.metadata.fromCache && snap.size > 0) {
                    clearTimeout(timer);
                }
                _categories.length = 0;
                snap.forEach(function (doc) {
                    _categories.push({ id: doc.id, data: doc.data() });
                });
                onUpdate(_categories.slice());
            },
            function (err) {
                console.warn('[menu-data] categories error:', err.message);
                onError(err);
            }
        );
    }

    function getItems() { return _items; }
    function getCategories() { return _categories; }

    function filterItems(searchTerm, category) {
        var filtered = _items.slice();
        if (searchTerm) {
            var lang = localStorage.getItem('selectedLang') || 'ku';
            var term = searchTerm.toLowerCase();
            filtered = filtered.filter(function (d) {
                var name = (d['name_' + lang] || d.name_en || d.name_ar || d.name_ku || '').toLowerCase();
                return name.indexOf(term) !== -1;
            });
        }
        if (category && category !== 'all') {
            var catLower = String(category).toLowerCase();
            filtered = filtered.filter(function (d) {
                return d.category && String(d.category).toLowerCase() === catLower;
            });
        }
        return filtered;
    }

    function unsubscribeAll() {
        if (_itemsUnsub) { _itemsUnsub(); _itemsUnsub = null; }
        if (_categoriesUnsub) { _categoriesUnsub(); _categoriesUnsub = null; }
        _items.length = 0;
        _categories.length = 0;
    }

    window.MenuData = {
        loadItems: loadItems,
        loadCategories: loadCategories,
        getItems: getItems,
        getCategories: getCategories,
        filterItems: filterItems,
        unsubscribeAll: unsubscribeAll
    };
})();




