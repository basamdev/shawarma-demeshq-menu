// js/menu-data.js - Optimized shared data layer
// Uses onSnapshot as the primary source with a get() timeout fallback.
// Caches items and categories in memory so filtering is instant and
// menu.html / admin.html only read Firestore once per page load.
(function () {
    'use strict';

    var _items = [];
    var _categories = [];
    var _itemsUnsub = null;
    var _categoriesUnsub = null;

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

        var timer = setTimeout(function () {
            window.db.collection('menuItems').get()
                .then(function (snap) {
                    _items.length = 0;
                    _items.push.apply(_items, collectItemDocs(snap));
                    onUpdate(_items.slice());
                })
                .catch(onError);
        }, timeoutMs || 4000);

        _itemsUnsub = window.db.collection('menuItems').onSnapshot(
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

        var timer = setTimeout(function () {
            window.db.collection('categories').orderBy('order', 'asc').get()
                .then(function (snap) {
                    _categories.length = 0;
                    snap.forEach(function (doc) {
                        _categories.push({ id: doc.id, data: doc.data() });
                    });
                    onUpdate(_categories.slice());
                })
                .catch(onError);
        }, timeoutMs || 4000);

        _categoriesUnsub = window.db.collection('categories').orderBy('order', 'asc').onSnapshot(
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
