// App.js — Shawarma Premium Menu
// Handles: i18n, theme, category filtering, product detail modal, video player

window.openMenu = function (lang) {
    localStorage.setItem('selectedLang', lang);
    window.location.href = 'menu.html?lang=' + lang;
};

// Use local API instead of Firebase
var USE_LOCAL_API = false;
var API_BASE = 'api';

function localApiRequest(endpoint, options) {
    options = options || {};
    // Resolve the API URL absolutely (same logic as getApiUrl in local-api.js)
    // so requests work regardless of how the page is served. Falling back to a
    // relative URL only works when the document and the API share an origin.
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

document.addEventListener('DOMContentLoaded', function () {
    try {
        var staleInstall = document.getElementById('installTutorialOverlay');
        if (staleInstall) staleInstall.remove();
        document.body.classList.remove('install-tutorial-open');

        const urlLang = new URLSearchParams(window.location.search).get('lang');
        const savedLang = urlLang || localStorage.getItem('selectedLang') || 'ku';
        if (urlLang) localStorage.setItem('selectedLang', urlLang);
        setActiveLanguage(savedLang);
        applyLanguageUI(savedLang);
        setupThemeToggle();
        setupOfflineDetection();

        if (document.getElementById('menuGrid')) {
            loadCafeSettingsFromFirestore(function () {
                updateCafeInfoPanel();
                subscribeCafeSettingsUpdates();
            });
            loadMenuItems();
            setupLanguageButtons();
            initHeroTitleSequence();
            setupInstallTutorial();
        } else if (document.getElementById('heroTypewriter')) {
            initHeroTitleSequence();
        }
    } catch (e) {
        console.error('Init error:', e);
    }
});

/* ========================================
   Customer Location (cart → WhatsApp)
   ======================================== */

window._customerLocationUrl = '';

function useCurrentLocation() {
    var statusEl = document.getElementById('cartLocationStatus');
    if (!statusEl) return;

    if (!navigator.geolocation) {
        statusEl.textContent = 'Geolocation is not supported by your browser. You can continue without it.';
        statusEl.className = 'cart-location-status error';
        statusEl.classList.remove('hidden');
        return;
    }

    statusEl.textContent = 'Getting your location...';
    statusEl.className = 'cart-location-status';
    statusEl.classList.remove('hidden');

    navigator.geolocation.getCurrentPosition(
        function (pos) {
            var lat = pos.coords.latitude;
            var lng = pos.coords.longitude;
            window._customerLocationUrl = 'https://maps.google.com/?q=' + lat + ',' + lng;
            statusEl.textContent = 'Location captured ✓';
            statusEl.className = 'cart-location-status success';
        },
        function (err) {
            window._customerLocationUrl = '';
            var msg = 'Unable to get location. You can continue without it.';
            if (err.code === 1) msg = 'Location permission denied. You can continue without it.';
            statusEl.textContent = msg;
            statusEl.className = 'cart-location-status error';
            statusEl.classList.remove('hidden');
        },
        { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 }
    );
}

/* ========================================
   i18n
   ======================================== */

const i18n = {
    ku: {
        menuTitle: 'مێنووی ئێمە',
        loadingMenu: 'داگرتنی مێنوو...',
        noItems: 'هیچ شتێک نییە لە مێنوودا.',
        noCategoryItems: 'هیچ شتێک نییە لەم بەشەدا.',
        errorLoadingMenu: 'هەڵە لە داگرتنی مێنوودا.',
        menuLoadRetry: 'دووبارە هەوڵبدەرەوە',
        menuConnectionHint: 'پەیوەندی ئینتەرنێت یان ڕێکخستنی Firebase بپشکنە.',
        noCategories: 'هیچ بەشێک نییە.',
        pageTitle: 'Shawarma | مێنوو',
        dashboard: 'داشبۆرد',
        manageItems: 'بەڕێوەبردنی ئایتمەکان',
        manageCategories: 'بەڕێوەبردنی بەشەکان',
        reports: 'ڕاپۆرتەکان',
        cashier: 'کاشێر',
        settings: 'ڕێکخستنەکان',
        logout: 'دەرچوون',
        admin: 'بەڕێوەبەر',
        ku: 'کوردی',
        ar: 'عەرەبی',
        en: 'ئینگلیزی',
        coffee: 'قاوە',
        tea: 'چای',
        dessert: 'شیرینی',
        coldDrinks: 'خواردنەوەی سارد',
        shisha: 'نێرگیلە',
        specialDrinks: 'خواردنەوەی تایبەت',
        viewDetails: 'بینینی زیاتر',
        todaySales: 'فرۆشتنی ئەمڕۆ',
        todayOrders: 'داواکارییەکانی ئەمڕۆ',
        monthlySales: 'فرۆشتنی ئەم مانگە',
        totalOrders: 'کۆی هەموو داواکارییەکان',
        bestSelling: 'باشترین فرۆشراو',
        selectMonth: 'مانگ هەڵبژێرە',
        dailySales: 'فرۆشتنی ڕۆژانە',
        noSalesData: 'هیچ داتای فرۆشتن نییە',
        january: 'کانوونی دووەم',
        february: 'شوبات',
        march: 'ئازار',
        april: 'نیسان',
        may: 'ئایار',
        june: 'حوزەیران',
        july: 'تەمووز',
        august: 'ئاب',
        september: 'ئەیلوول',
        october: 'تشرینی یەکەم',
        november: 'تشرینی دووەم',
        december: 'کانونی یەکەم',
        week: 'هەفتە',
        totalSales: 'کۆی هەموو فرۆشتن',
        weeklySales: 'فرۆشتنی ئەم هەفتەیە',
        recentSales: 'نوێترین فرۆشتنەکان',
        time: 'کات',
        items: 'ئایتم',
        total: 'کۆی گشتی',
        noSalesYet: 'هیچ فرۆشتنێک نییە تا ئێستا',
        noSalesData: 'هیچ داتایەکی فرۆشتن بەردەست نییە',
        addNewItem: '+ زیادکردنی ئایتمی نوێ',
        searchItems: 'گەڕان بۆ ئایتم...',
        allCategories: 'هەموو بەشەکان',
        allItems: 'هەموو',
        select: 'هەڵبژێرە',
        kurdishName: 'ناو بە کوردی',
        arabicName: 'ناو بە عەرەبی',
        englishName: 'ناو بە ئینگلیزی',
        kurdishDesc: 'وەسف بە کوردی',
        arabicDesc: 'وەسف بە عەرەبی',
        englishDesc: 'وەسف بە ئینگلیزی',
        imageURL: 'بەستەری وێنە',
        price: 'نرخ (IQD)',
        category: 'بەش',
        available: 'بەردەستە',
        notAvailable: 'بەردەست نییە',
        saveItem: 'پاشەکەوتکردن',
        cancel: 'پاشگەزبوونەوە',
        edit: 'دەستکاری',
        delete: 'سڕینەوە',
        deleteConfirm: 'دڵنیایت لە سڕینەوەی ئەم ئایتمە؟',
        fillAll: 'تکایە هەموو خانەکان پڕ بکەرەوە',
        selectCategory: 'تکایە بەشێک هەڵبژێرە (Category)',
        itemSaved: 'ئایتم پاشەکەوت کرا!',
        itemSavedCloud: 'پاشەکەوت کرا — مێنوو بۆ هەموو کڕیارەکان نوێکرایەوە!',
        itemSavedOffline: 'لە مۆبایل پاشەکەوت کرا — کاتێک ئینتەرنێت هەبوو بۆ مێنوو دەچێت.',
        itemSyncFailed: 'نەتوانرا بۆ ئینتەرنێت بنێردرێت. ئینتەرنێت بپشکنە و دووبارە هەوڵبدەرەوە.',
        connectionSlow: 'پەیوەندی خاوە — دووبارە هەوڵبدەرەوە.',
        itemError: 'هەڵە: ',
        categoriesList: 'بەشەکانی سیستەم:',
        noItemsFound: 'هیچ ئایتمێک نەدۆزرایەوە',
        weeklySales: 'فرۆشتنی ئەم هەفتەیە',
        totalSales: 'کۆی گشتی فرۆشتن',
        currentOrder: 'داواکاریی ئێستا',
        clear: 'خاوێنکردنەوە',
        payNow: '💳 پارەدان',
        addFirst: 'تکایە سەرەتا ئایتم زیاد بکە',
        paymentSuccess: 'پارەدان سەرکەوتوو بوو! کۆی گشتی: ',
        noItemsAdded: 'هیچ ئایتمێک زیاد نەکراوە.\nکلیک لەسەر ئایتم بکە بۆ زیادکردن.',
        cafeName: 'ناوی کافێ',
        locationMapsUrl: 'لینکی نەخشە (Google Maps)',
        locationLabelField: 'ناونیشان (دەردەکەوێت لە مێنوو)',
        cafeOpenTimeLabel: 'کاتی کردنەوە',
        cafeCloseTimeLabel: 'کاتی داخراو',
        cafeOpenTimePlaceholder: '٢:٠٠ دوای نیوەڕۆ',
        cafeCloseTimePlaceholder: '٢:٠٠ بەیانی',
        timeAm: 'بەیانی',
        timePm: 'ئێوارە',
        applyTime: 'جێبەجێکردن',
        saveHours: 'پاشەکەوتکردنی کاتەکان',
        hoursSaved: 'کاتەکان پاشەکەوت کران!',
        cafeHoursDaily: 'ڕۆژانە',
        callWhatsAppNumber: 'ژمارەی پەیوەندی / واتساپ',
        currency: 'دراو',
        saveSettings: 'پاشەکەوتکردن',
        settingsSaved: 'ڕێکخستنەکان پاشەکەوت کران!',
        yes: 'بەڵێ',
        no: 'نەخێر',
        sectionNotFound: 'بەش نەدۆزرایەوە',
        errorLoading: 'هەڵە لە بارکردن: ',
        loading: 'بارکردن...',
        errorLoadingSection: 'هەڵە لە بارکردنی بەش ',
        errorPrefix: 'هەڵە: ',
        unnamed: 'بێ ناو',
        editItem: 'دەستکاری ئایتم',
        editExpense: 'دەستکاری خەرجی',
        addNewItem: '+ زیادکردنی ئایتمی نوێ',
        sold: 'دانە',
        itemsCount: ' ئایتم',
        unknown: 'نەناسراو',
        siteName: 'Shawarma',
        addCategory: '+ زیادکردنی بەشی نوێ',
        categoryNameKu: 'ناوی بەش بە کوردی',
        categoryNameAr: 'ناوی بەش بە عەرەبی',
        categoryNameEn: 'ناوی بەش بە ئینگلیزی',
        categoryImage: 'بەستەری وێنەی بەش',
        saveCategory: 'پاشەکەوتکردنی بەش',
        editCategory: 'دەستکاری بەش',
        deleteCategory: 'سڕینەوەی بەش',
        deleteCategoryConfirm: 'دڵنیایت لە سڕینەوەی ئەم بەشە؟ هەموو ئایتمەکانی ئەم بەشە دەسڕێنەوە.',
        categorySaved: 'بەش پاشەکەوت کرا!',
        categorySavedCloud: 'بەش پاشەکەوت کرا — مێنوو نوێکرایەوە!',
        categorySavedOffline: 'بەش لە مۆبایل پاشەکەوت کرا — دواتر بۆ مێنوو دەچێت.',
        categoryError: 'هەڵە لە بەش: ',
        createNewCategory: '+ دروستکردنی بەشی نوێ',
        likeItem: 'پەسەندکردن',
        unlikeItem: 'لابردنی پەسەندکردن',
        printReceipt: 'چاپ',
        offlineMode: 'بێ هێڵ — گۆڕانکارییەکان دەهێنرێنە ڕێک',
        backOnline: 'گەڕایەوە سەرهێڵ — ڕێکخستن',
        resetAllData: 'سڕینەوەی هەموو داتاکان',
        resetConfirm: 'دڵنیایت لە سڕینەوەی هەموو داتاکان؟ ئەم کارە ناتوانرێت بگەرێتەوە !',
        resetSuccess: 'هەموو داتاکان سڕانەوە!',
        resetError: 'هەڵە لە سڕینەوە: ',
        expenses: 'خەرجیەکان',
        addExpense: '+ زیادکردنی خەرجی',
        expenseName: 'ناوی خەرجی',
        expensePrice: 'نرخ (IQD)',
        expenseDate: 'بەروار',
        expenseTime: 'کات',
        expenseSaved: 'خەرجی پاشەکەوت کرا!',
        expenseSavedOffline: 'خەرجی لەسەر ئامێرەکەت پاشەکەوت کرا — کاتێک ئینتەرنێت هات، خۆکار دەنێردرێت.',
        expenseError: 'هەڵە لە خەرجی: ',
        expenseDeleted: 'خەرجی سڕایەوە!',
        expenseDeletedOffline: 'خەرجی لەسەر ئامێرەکەت سڕایەوە.',
        totalExpenses: 'کۆی خەرجیەکان',
        todayExpenses: 'خەرجیەکانی ئەمڕۆ',
        monthlyExpenses: 'خەرجیەکانی ئەم مانگە',
        netIncome: 'داتای خاو',
        noExpenses: 'هیچ خەرجیەک نییە',
        deleteExpenseConfirm: 'دڵنیایت لە سڕینەوەی ئەم خەرجیە؟',
        water: 'ئاو',
        milk: 'شیر',
        coffee: 'قاوە',
        electric: 'کارەبا',
        gas: 'گاز',
        rent: 'کرێ',
        salary: 'مووچە',
        other: 'هیتر',
        cart: 'سەبەتە',
        addToCart: '+ زیادکردن بۆ سەبەتە',
        remove: 'لابردن',
        cartEmpty: 'سەبەتە بەتاڵە',
        cartTotal: 'کۆی گشتی',
        sendWhatsApp: 'ناردن بە واتساپ',
        useCurrentLocation: '📍ناردن لینکی لۆکەیشن',
        needLocation: 'تکایە لۆکەیشنەکەت بنێرە پێش ناردن بە واتساپ',
        whatsappPhone: 'ژمارەی واتساپ',
        phonePlaceholder: '٩٦٤٧٧٠١٢٣٤٥٦٧',
        orderSent: 'داواکاری نێردرا!',
        quantity: 'ژمارە',
        themeWhite: 'سپی',
        themeCream: 'کرێم',
        themeCoffee: 'قاوە',
        themeGold: 'زێڕین',
        themeMocha: 'موکا',
        themeDark: 'تاریک',
        cafeOpen: 'ئێستا کراوەیە',
        cafeClosed: 'ئێستا داخراوە',
        cafeContact: 'پەیوەندی',
        cafeCall: 'پەیوەندی',
        cafeWhatsapp: 'واتساپ',
        cafeShare: 'هاوبەشکردن',
        cafeLocation: 'شوێن',
        cafeHours: 'کاتی کردنەوە',
        cafeHoursValue: 'ڕۆژانە: ٢:٠٠ دوای نیوەڕۆ — ٢:٠٠ بەیانی',
        cafeFollowUs: 'فۆڵۆومان بکەن',
        socialLinks: 'لینکەکانی سۆشیاڵ میدیا',
        socialLinksHint: 'لینکی ئینستاگرام، تیکتۆک و سنەپچات — لە بەشی «فۆڵۆومان بکەن» دەردەکەون',
        instagramUrl: 'ئینستاگرام',
        tiktokUrl: 'تیکتۆک',
        snapchatUrl: 'سنەپچات',
        cafeInfoTitle: 'Shawarma',
        linkCopied: 'بەستەر کۆپی کرا!',
        installTitle: 'زیادکردن بۆ سکرینی سەرەکی',
        installSubtitle: 'زیادکردنی مینیۆ کەمان بوو ناو سکرین وەکو ئەپلیکەیشن',
        installIos: 'iPhone (iOS)',
        installAndroid: 'Android',
        installGotIt: 'تێگەیشتم',
        installDontShow: 'دووبارە پیشان مەدە',
        installShowHelp: 'زیادکردن بۆ سکرینی سەرەکی',
        installNow: 'ئێستا دابمەزرێنە',
    },
    ar: {
        menuTitle: 'قائمتنا',
        loadingMenu: 'جارٍ تحميل القائمة...',
        noItems: 'لا توجد عناصر في القائمة.',
        noCategoryItems: 'لا توجد عناصر في هذا القسم.',
        errorLoadingMenu: 'حدث خطأ أثناء تحميل القائمة.',
        menuLoadRetry: 'إعادة المحاولة',
        menuConnectionHint: 'تحقق من الإنترنت أو إعدادات Firebase.',
        noCategories: 'لا توجد أقسام.',
        pageTitle: 'Shawarma | القائمة',
        dashboard: 'لوحة التحكم',
        manageItems: 'إدارة العناصر',
        manageCategories: 'إدارة الفئات',
        reports: 'التقارير',
        cashier: 'الصندوق',
        settings: 'الإعدادات',
        logout: 'تسجيل الخروج',
        admin: 'المشرف',
        ku: 'كوردي',
        ar: 'عربي',
        en: 'English',
        coffee: 'قهوة',
        tea: 'شاي',
        dessert: 'حلوى',
        coldDrinks: 'مشروبات باردة',
        shisha: 'نرگیلة',
        specialDrinks: 'مشروبات خاصة',
        viewDetails: 'عرض التفاصيل',
        todaySales: 'مبيعات اليوم',
        todayOrders: 'طلبات اليوم',
        monthlySales: 'مبيعات الشهر',
        totalOrders: 'إجمالي الطلبات',
        bestSelling: 'الأكثر مبيعاً',
        selectMonth: 'اختر الشهر',
        dailySales: 'المبيعات اليومية',
        noSalesData: 'لا توجد بيانات مبيعات',
        january: 'كانون الثاني',
        february: 'شباط',
        march: 'آذار',
        april: 'نيسان',
        may: 'آيار',
        june: 'حزيران',
        july: 'تموز',
        august: 'آب',
        september: 'أيلول',
        october: 'تشرين الأول',
        november: 'تشرين الثاني',
        december: 'كانون الأول',
        week: 'أسبوع',
        totalSales: 'إجمالي المبيعات',
        weeklySales: 'مبيعات الأسبوع',
        recentSales: 'المبيعات الأخيرة',
        time: 'الوقت',
        items: 'عناصر',
        total: 'الإجمالي',
        noSalesYet: 'لا توجد مبيعات بعد',
        noSalesData: 'لا توجد بيانات مبيعات',
        addNewItem: '+ إضافة عنصر جديد',
        searchItems: 'البحث عن عناصر...',
        allCategories: 'جميع الفئات',
        allItems: 'الكل',
        select: 'اختر',
        kurdishName: 'الاسم الكردي',
        arabicName: 'الاسم العربي',
        englishName: 'الاسم الإنجليزي',
        kurdishDesc: 'الوصف الكردي',
        arabicDesc: 'الوصف العربي',
        englishDesc: 'الوصف الإنجليزي',
        imageURL: 'رابط الصورة',
        price: 'السعر (IQD)',
        category: 'الفئة',
        available: 'متاح',
        notAvailable: 'غير متاح',
        saveItem: 'حفظ',
        cancel: 'إلغاء',
        edit: 'تعديل',
        delete: 'حذف',
        deleteConfirm: 'هل أنت متأكد من حذف هذا العنصر؟',
        fillAll: 'يرجى ملء جميع الحقول المطلوبة',
        selectCategory: 'يرجى اختيار القسم (Category)',
        itemSaved: 'تم حفظ العنصر!',
        itemSavedCloud: 'تم الحفظ — تم تحديث القائمة لجميع الزبائن!',
        itemSavedOffline: 'حُفظ على الهاتف — سيظهر في القائمة عند الاتصال بالإنترنت.',
        itemSyncFailed: 'تعذر المزامنة مع السحابة. تحقق من الإنترنت وحاول مرة أخرى.',
        connectionSlow: 'الاتصال بطيء — حاول مرة أخرى.',
        itemError: 'خطأ: ',
        categoriesList: 'فئات النظام:',
        noItemsFound: 'لم يتم العثور على عناصر',
        weeklySales: 'مبيعات الأسبوع',
        totalSales: 'إجمالي المبيعات',
        currentOrder: 'الطلب الحالي',
        clear: 'مسح',
        payNow: '💳 ادفع الآن',
        addFirst: 'يرجى إضافة عناصر أولاً',
        paymentSuccess: 'تم الدفع بنجاح! الإجمالي: ',
        noItemsAdded: 'لم تتم إضافة أي عناصر.\nاضغط على العناصر لإضافتها.',
        cafeName: 'اسم المقهى',
        locationMapsUrl: 'رابط الخريطة (Google Maps)',
        locationLabelField: 'العنوان (يظهر في القائمة)',
        cafeOpenTimeLabel: 'وقت الفتح',
        cafeCloseTimeLabel: 'وقت الإغلاق',
        cafeOpenTimePlaceholder: '٢:٠٠ مساءً',
        cafeCloseTimePlaceholder: '٢:٠٠ صباحاً',
        timeAm: 'صباحاً',
        timePm: 'مساءً',
        applyTime: 'تطبيق',
        saveHours: 'حفظ الأوقات',
        hoursSaved: 'تم حفظ الأوقات!',
        cafeHoursDaily: 'يومياً',
        callWhatsAppNumber: 'رقم الاتصال / واتساب',
        currency: 'العملة',
        saveSettings: 'حفظ الإعدادات',
        settingsSaved: 'تم حفظ الإعدادات!',
        yes: 'نعم',
        no: 'لا',
        sectionNotFound: 'القسم غير موجود',
        errorLoading: 'خطأ في التحميل: ',
        loading: 'جارٍ التحميل...',
        errorLoadingSection: 'خطأ في تحميل القسم ',
        errorPrefix: 'خطأ: ',
        unnamed: 'بلا اسم',
        editItem: 'تعديل العنصر',
        editExpense: 'تعديل المصروف',
        addNewItem: '+ إضافة عنصر جديد',
        sold: 'قطعة',
        itemsCount: ' عناصر',
        unknown: 'غير معروف',
        siteName: 'Shawarma',
        addCategory: '+ إضافة فئة جديدة',
        categoryNameKu: 'اسم الفئة بالكردية',
        categoryNameAr: 'اسم الفئة بالعربية',
        categoryNameEn: 'اسم الفئة بالإنجليزية',
        categoryImage: 'رابط صورة الفئة',
        saveCategory: 'حفظ الفئة',
        editCategory: 'تعديل الفئة',
        deleteCategory: 'حذف الفئة',
        deleteCategoryConfirm: 'هل أنت متأكد من حذف هذه الفئة؟ سيتم حذف جميع العناصر في هذه الفئة.',
        categorySaved: 'تم حفظ الفئة!',
        categorySavedCloud: 'تم حفظ الفئة — تم تحديث القائمة!',
        categorySavedOffline: 'حُفظت الفئة على الهاتف — ستُزامَن لاحقاً.',
        categoryError: 'خطأ في الفئة: ',
        createNewCategory: '+ إنشاء فئة جديدة',
        likeItem: 'إعجاب',
        unlikeItem: 'إلغاء الإعجاب',
        printReceipt: 'طباعة',
        offlineMode: 'بدون إنترنت — ستتم المزامنة',
        backOnline: 'عاد الاتصال — تتم المزامنة',
        resetAllData: 'حذف جميع البيانات',
        resetConfirm: 'هل أنت متأكد من حذف جميع البيانات؟ لا يمكن التراجع عن هذا!',
        resetSuccess: 'تم حذف جميع البيانات!',
        resetError: 'خطأ في الحذف: ',
        expenses: 'المصروفات',
        addExpense: '+ إضافة مصروف',
        expenseName: 'اسم المصروف',
        expensePrice: 'السعر (IQD)',
        expenseDate: 'التاريخ',
        expenseTime: 'الوقت',
        expenseSaved: 'تم حفظ المصروف!',
        expenseSavedOffline: 'تم حفظ المصروف على جهازك — سيُزامَن تلقائياً عند عودة الإنترنت.',
        expenseError: 'خطأ في المصروف: ',
        expenseDeleted: 'تم حذف المصروف!',
        expenseDeletedOffline: 'تم حذف المصروف من جهازك.',
        totalExpenses: 'إجمالي المصروفات',
        todayExpenses: 'مصروفات اليوم',
        monthlyExpenses: 'مصروفات الشهر',
        netIncome: 'الدخل الصافي',
        noExpenses: 'لا توجد مصروفات',
        deleteExpenseConfirm: 'هل أنت متأكد من حذف هذا المصروف؟',
        water: 'ماء',
        milk: 'حليب',
        coffee: 'قهوة',
        electric: 'كهرباء',
        gas: 'غاز',
        rent: 'إيجار',
        salary: 'راتب',
        other: 'أخرى',
        cart: 'السلة',
        addToCart: '+ إضافة للسلة',
        remove: 'إزالة',
        cartEmpty: 'السلة فارغة',
        cartTotal: 'الإجمالي',
        sendWhatsApp: 'إرسال واتساب',
        useCurrentLocation: '📍 إرسال رابط الموقع',
        needLocation: 'الرجاء إرسال موقعك قبل الإرسال عبر واتساب',
        whatsappPhone: 'رقم واتساب',
        phonePlaceholder: '٩٦٤٧٧٠١٢٣٤٥٦٧',
        orderSent: 'تم إرسال الطلب!',
        quantity: 'الكمية',
        themeWhite: 'أبيض',
        themeCream: 'كريمي',
        themeCoffee: 'قهوة',
        themeGold: 'ذهبي',
        themeMocha: 'موكا',
        themeDark: 'داكن',
        cafeOpen: 'مفتوح الآن',
        cafeClosed: 'مغلق الآن',
        cafeContact: 'تواصل',
        cafeCall: 'اتصال',
        cafeWhatsapp: 'واتساب',
        cafeShare: 'مشاركة',
        cafeLocation: 'الموقع',
        cafeHours: 'ساعات العمل',
        cafeHoursValue: 'يومياً: ٢:٠٠ مساءً — ٢:٠٠ صباحاً',
        cafeFollowUs: 'تابعنا',
        socialLinks: 'روابط التواصل',
        socialLinksHint: 'روابط إنستغرام وتيك توك وسناب شات — تظهر في «تابعنا»',
        instagramUrl: 'إنستغرام',
        tiktokUrl: 'تيك توك',
        snapchatUrl: 'سناب شات',
        cafeInfoTitle: 'Shawarma',
        linkCopied: 'تم نسخ الرابط!',
        installTitle: 'إضافة إلى الشاشة الرئيسية',
        installSubtitle: 'أضف قائمتنا إلى الشاشة الرئيسية كتطبيق',
        installIos: 'iPhone (iOS)',
        installAndroid: 'Android',
        installGotIt: 'فهمت',
        installDontShow: 'لا تظهر مرة أخرى',
        installShowHelp: 'إضافة للشاشة الرئيسية',
        installNow: 'تثبيت الآن',
        androidStep4: 'اضغط «Install» — يُثبت تطبيق Shawarma',
    },
    en: {
        menuTitle: 'Our Menu',
        loadingMenu: 'Loading menu items...',
        noItems: 'No menu items found.',
        noCategoryItems: 'No items in this category.',
        errorLoadingMenu: 'Error loading menu.',
        menuLoadRetry: 'Try again',
        menuConnectionHint: 'Check internet or Firebase settings for this domain.',
        noCategories: 'No categories.',
        pageTitle: 'Shawarma | Menu',
        dashboard: 'Dashboard',
        manageItems: 'Manage Items',
        manageCategories: 'Manage Categories',
        reports: 'Reports',
        cashier: 'Cashier',
        settings: 'Settings',
        logout: 'Logout',
        admin: 'Admin',
        ku: 'Kurdish',
        ar: 'Arabic',
        en: 'English',
        coffee: 'Coffee',
        tea: 'Tea',
        dessert: 'Dessert',
        coldDrinks: 'Cold Drinks',
        shisha: 'Shisha',
        specialDrinks: 'Special Drinks',
        viewDetails: 'View',
        todaySales: 'Today Sales',
        todayOrders: "Today's Orders",
        monthlySales: 'Monthly Sales',
        totalOrders: 'Total Orders',
        bestSelling: 'Best Selling',
        selectMonth: 'Select Month',
        dailySales: 'Daily Sales',
        noSalesData: 'No sales data',
        january: 'January',
        february: 'February',
        march: 'March',
        april: 'April',
        may: 'May',
        june: 'June',
        july: 'July',
        august: 'August',
        september: 'September',
        october: 'October',
        november: 'November',
        december: 'December',
        week: 'Week',
        totalSales: 'Total Sales',
        weeklySales: 'Weekly Sales',
        recentSales: 'Recent Sales',
        time: 'Time',
        items: 'Items',
        total: 'Total',
        noSalesYet: 'No sales yet',
        noSalesData: 'No sales data',
        addNewItem: '+ Add New Item',
        searchItems: 'Search items...',
        allCategories: 'All Categories',
        allItems: 'All',
        select: 'Select',
        kurdishName: 'Kurdish Name',
        arabicName: 'Arabic Name',
        englishName: 'English Name',
        kurdishDesc: 'Kurdish Description',
        arabicDesc: 'Arabic Description',
        englishDesc: 'English Description',
        imageURL: 'Image URL',
        price: 'Price (IQD)',
        category: 'Category',
        group: 'Group',
        available: 'Available',
        notAvailable: 'Not available',
        saveItem: 'Save Item',
        cancel: 'Cancel',
        edit: 'Edit',
        delete: 'Delete',
        deleteConfirm: 'Are you sure you want to delete this item?',
        fillAll: 'Please fill in all required fields',
        selectCategory: 'Please select a category',
        itemSaved: 'Item saved!',
        itemSavedCloud: 'Saved — menu updated for all customers!',
        itemSavedOffline: 'Saved on this phone — will sync to menu when online.',
        itemSyncFailed: 'Could not sync to cloud. Check internet and try again.',
        connectionSlow: 'Connection slow — try again.',
        itemError: 'Error: ',
        categoriesList: 'System categories:',
        noItemsFound: 'No items found',
        weeklySales: 'Weekly Sales',
        totalSales: 'Total Sales',
        currentOrder: 'Current Order',
        clear: 'Clear',
        payNow: '💳 Pay Now',
        addFirst: 'Please add items first',
        paymentSuccess: 'Payment successful! Total: ',
        noItemsAdded: 'No items added yet.\nTap items to add them.',
        cafeName: 'Cafe Name',
        locationMapsUrl: 'Map link (Google Maps)',
        locationLabelField: 'Address label (shown on menu)',
        cafeOpenTimeLabel: 'Opening time',
        cafeCloseTimeLabel: 'Closing time',
        cafeOpenTimePlaceholder: '2:00 PM',
        cafeCloseTimePlaceholder: '2:00 AM',
        timeAm: 'Morning',
        timePm: 'Evening',
        applyTime: 'Apply',
        saveHours: 'Save hours',
        hoursSaved: 'Hours saved!',
        cafeHoursDaily: 'Daily',
        callWhatsAppNumber: 'Call / WhatsApp number',
        currency: 'Currency',
        saveSettings: 'Save Settings',
        settingsSaved: 'Settings saved!',
        yes: 'Yes',
        no: 'No',
        sectionNotFound: 'Section not found',
        errorLoading: 'Error loading: ',
        searchPlaceholder: 'Search menu...',
        noSearchResults: 'No items found for',
        favorites: 'Favorites',
        addToFavorites: 'Add to favorites',
        removeFromFavorites: 'Removed from favorites',
        rated: 'Rated',
        stars: 'stars',
        itemAddedToCart: 'Added to cart',
        viewCart: 'View Cart',
        cart: 'Cart',
        cartEmpty: 'Cart is empty',
        quantity: 'Qty',
        checkout: 'Checkout',
        orderPlaced: 'Order placed successfully! Total: ',
        orderError: 'Error placing order: ',
        loading: 'Loading...',
        errorLoadingSection: 'Error loading section ',
        errorPrefix: 'Error: ',
        sectionNotFound: 'Section not found',
        unnamed: 'Unnamed',
        editItem: 'Edit Item',
        editExpense: 'Edit Expense',
        addNewItem: 'Add New Item',
        sold: 'sold',
        itemsCount: ' items',
        unknown: 'unknown',
        siteName: 'Shawarma',
        addCategory: '+ Add New Category',
        categoryNameKu: 'Category Name (Kurdish)',
        categoryNameAr: 'Category Name (Arabic)',
        categoryNameEn: 'Category Name (English)',
        categoryImage: 'Category Image URL',
        saveCategory: 'Save Category',
        editCategory: 'Edit Category',
        deleteCategory: 'Delete Category',
        deleteCategoryConfirm: 'Are you sure you want to delete this category? All items in this category will be deleted.',
        categorySaved: 'Category saved!',
        categorySavedCloud: 'Category saved — menu updated!',
        categorySavedOffline: 'Category saved on phone — will sync when online.',
        categoryError: 'Category error: ',
        createNewCategory: '+ Create New Category',
        likeItem: 'Like',
        unlikeItem: 'Unlike',
        printReceipt: 'Print',
        offlineMode: 'Offline Mode — changes will sync',
        backOnline: 'Back online — syncing',
        onlineMode: 'Online',
        resetAllData: 'Reset All Data',
        resetConfirm: 'Are you sure you want to delete ALL data? This cannot be undone!',
        resetSuccess: 'All data has been deleted!',
        resetError: 'Error resetting: ',
        expenses: 'Expenses',
        addExpense: '+ Add Expense',
        expenseName: 'Expense Name',
        expensePrice: 'Price (IQD)',
        expenseDate: 'Date',
        expenseTime: 'Time',
        expenseSaved: 'Expense saved!',
        expenseSavedOffline: 'Expense saved on this device — will sync when internet returns.',
        expenseError: 'Error: ',
        expenseDeleted: 'Expense deleted!',
        expenseDeletedOffline: 'Expense removed on this device.',
        totalExpenses: 'Total Expenses',
        todayExpenses: 'Today Expenses',
        monthlyExpenses: 'Monthly Expenses',
        netIncome: 'Net Income',
        noExpenses: 'No expenses yet',
        deleteExpenseConfirm: 'Are you sure you want to delete this expense?',
        water: 'Water',
        milk: 'Milk',
        coffee: 'Coffee',
        electric: 'Electricity',
        gas: 'Gas',
        rent: 'Rent',
        salary: 'Salary',
        other: 'Other',
        cart: 'Cart',
        addToCart: '+ Add to Cart',
        remove: 'Remove',
        cartEmpty: 'Cart is empty',
        cartTotal: 'Total',
        sendWhatsApp: 'Send via WhatsApp',
        useCurrentLocation: '📍 Use Current Location',
        needLocation: 'Please send your location before sending via WhatsApp',
        whatsappPhone: 'WhatsApp Number',
        phonePlaceholder: '+9647701234567',
        orderSent: 'Order sent!',
        quantity: 'Qty',
        themeWhite: 'White',
        themeCream: 'Cream',
        themeCoffee: 'Coffee',
        themeGold: 'Gold',
        themeMocha: 'Mocha',
        themeDark: 'Dark',
        cafeOpen: 'Open now',
        cafeClosed: 'Closed now',
        cafeContact: 'Contact',
        cafeCall: 'Call',
        cafeWhatsapp: 'WhatsApp',
        cafeShare: 'Share',
        cafeLocation: 'Location',
        cafeHours: 'Opening hours',
        cafeHoursValue: 'Daily: 2:00 PM — 2:00 AM',
        cafeFollowUs: 'Follow us',
        socialLinks: 'Social media links',
        socialLinksHint: 'Instagram, TikTok & Snapchat URLs — shown in Follow us',
        instagramUrl: 'Instagram',
        tiktokUrl: 'TikTok',
        snapchatUrl: 'Snapchat',
        cafeInfoTitle: 'Shawarma',
        linkCopied: 'Link copied!',
        installTitle: 'Add to Home Screen',
        installSubtitle: 'Add our menu to your home screen like an app',
        installIos: 'iPhone (iOS)',
        installAndroid: 'Android',
        installGotIt: 'Got it',
        installDontShow: 'Don\'t show again',
        installShowHelp: 'Add to Home Screen',
        installNow: 'Install now',
        installImagesMissing: 'Add tutorial images to images/install/',
        iosStep1: 'Tap Share (↗) at the bottom of Safari',
        iosStep2: 'Choose «Add to Home Screen»',
        iosStep3: 'Tap «Add» — Shawarma icon appears on your home screen',
        androidStep1: 'Tap Menu (⋮) at the top of Chrome',
        androidStep2: 'Choose «Add to Home screen»',
        androidStep3: 'Choose «Install»',
        androidStep4: 'Tap «Install» — Shawarma is added to your phone',
    }
};

/* ========================================
   State
   ======================================== */

let cachedMenuItems = [];
let _activeCategory = null;
const ALL_CATEGORY_ID = '__all__';
const PREFERRED_CATEGORY_ORDER = ['Coffee', 'Tea', 'Cold Drinks', 'Dessert', 'Shisha', 'Special Drinks'];
let _renderSerial = 0;
let _currentDetailItem = null;
let isOffline = false;
let cartItems = [];
let _lastMenuItemsSignature = '';
let _menuUiReady = false;

/* ========================================
   Menu Loading
   ======================================== */

function parseMenuItemsFromSnapshot(snapshot) {
    const items = [];
    snapshot.forEach(doc => {
        const data = { id: doc.id, ...doc.data() };
        if (data.category !== 'Water') items.push(data);
    });
    return items;
}

function normalizeMenuItemEntry(item) {
    if (!item || !item.id) return null;
    if (item.v && typeof item.v === 'object') {
        return Object.assign({ id: item.id }, item.v);
    }
    return item;
}

function normalizeMenuItemsList(items) {
    if (!Array.isArray(items)) return [];
    return items.map(normalizeMenuItemEntry).filter(function (item) {
        return item && item.category && item.category !== 'Water';
    });
}

function waitForFirebaseDb(maxMs) {
    maxMs = maxMs || 8000;
    if (window.dbReady) {
        return Promise.race([
            window.dbReady,
            new Promise(function (_, reject) {
                setTimeout(function () { reject(new Error('Firebase timeout')); }, maxMs);
            })
        ]);
    }
    return new Promise(function (resolve, reject) {
        if (window.db) {
            resolve(window.db);
            return;
        }
        var start = Date.now();
        var timer = setInterval(function () {
            if (window.db) {
                clearInterval(timer);
                resolve(window.db);
            } else if (Date.now() - start > maxMs) {
                clearInterval(timer);
                reject(new Error('Firebase not loaded'));
            }
        }, 50);
    });
}

function firestoreGetWithTimeout(ref, ms) {
    ms = ms || 8000;
    return Promise.race([
        ref.get(),
        new Promise(function (_, reject) {
            setTimeout(function () { reject(new Error('Connection timeout')); }, ms);
        })
    ]);
}

var APP_VERSION = 'v88';

function isFirestoreApiDisabledError(err) {
    if (!err || !err.message) return false;
    var m = err.message;
    var disabled = m.indexOf('Cloud Firestore API has not been used in project') !== -1 ||
        m.indexOf('SERVICE_DISABLED') !== -1 ||
        m.indexOf('firestore.googleapis.com/overview') !== -1;
    if (disabled) {
        window._firestoreApiDisabled = true;
    }
    return disabled;
}

function showFirestoreApiDisabledAlert() {
    if (window._firestoreApiDisabledAlerted) return;
    window._firestoreApiDisabledAlerted = true;
    var lang = localStorage.getItem('selectedLang') || 'ku';
    var strings = i18n[lang] || i18n.en;
    var projectId = (window.firebaseConfig && window.firebaseConfig.projectId) || 'shawarma-demashq-menu';
    var url = 'https://console.developers.google.com/apis/api/firestore.googleapis.com/overview?project=' + encodeURIComponent(projectId);
    alert('⚠️ ' + (strings.errorPrefix || 'Error:') + '\n\nCloud Firestore API is disabled for this project.\n\nPlease enable it here:\n' + url + '\n\nAfter enabling, wait a few minutes and refresh this page.');
}

function clearMenuLoadingSpinner() {
    var container = document.getElementById('menuGrid');
    if (!container) return;
    if (container.querySelector('.loading-menu')) {
        container.innerHTML = '';
    }
}

function menuStillLoading() {
    var container = document.getElementById('menuGrid');
    return !!(container && container.querySelector('.loading-menu'));
}

function paintMenuFromItems(items, options) {
    options = options || {};
    if (!items || !items.length) return false;
    cachedMenuItems = items;
    _lastMenuItemsSignature = menuItemsSignature(items);
    clearMenuLoadingSpinner();
    renderCategories(items, {
        autoSelect: options.autoSelect !== false,
        forceRebuild: true,
        forceFirst: true
    });
    var cat = _activeCategory || (isEmenuPage() ? ALL_CATEGORY_ID : null);
    if (cat) {
        switchCategory(cat, { silent: true, immediate: true });
    } else {
        autoSelectCategoryAfterRender(true);
    }
    _menuUiReady = true;
    setupCategoryScrollSpy();
    return true;
}

function restFieldValue(field) {
    if (!field || typeof field !== 'object') return null;
    if ('stringValue' in field) return field.stringValue;
    if ('integerValue' in field) return parseInt(field.integerValue, 10);
    if ('doubleValue' in field) return parseFloat(field.doubleValue);
    if ('booleanValue' in field) return !!field.booleanValue;
    if ('nullValue' in field) return null;
    return null;
}

function parseMenuItemsFromRest(json) {
    var items = [];
    (json.documents || []).forEach(function (doc) {
        var f = doc.fields || {};
        var id = doc.name.split('/').pop();
        var category = restFieldValue(f.category);
        if (category === 'Water') return;
        items.push({
            id: id,
            name_ku: restFieldValue(f.name_ku),
            name_ar: restFieldValue(f.name_ar),
            name_en: restFieldValue(f.name_en),
            price: restFieldValue(f.price),
            category: category,
            image: restFieldValue(f.image),
            available: restFieldValue(f.available) !== false,
            description_ku: restFieldValue(f.description_ku),
            description_ar: restFieldValue(f.description_ar),
            description_en: restFieldValue(f.description_en)
        });
    });
    return items;
}

function getFirestoreRestBaseUrl() {
    var emulatorInfo = window._firestoreEmulatorInfo;
    if (emulatorInfo) {
        return 'http://' + emulatorInfo.host + ':' + emulatorInfo.port + '/v1/projects/';
    }
    return 'https://firestore.googleapis.com/v1/projects/';
}

function fetchMenuViaRest(timeoutMs) {
    if (window._firestoreApiDisabled) return Promise.reject(new Error('Firestore API disabled'));
    timeoutMs = timeoutMs || 10000;
    var cfg = window.firebaseConfig;
    if (!cfg || !cfg.projectId || !cfg.apiKey) {
        return Promise.reject(new Error('Firebase config missing'));
    }
    var baseUrl = getFirestoreRestBaseUrl();
    var url = baseUrl + encodeURIComponent(cfg.projectId) +
        '/databases/(default)/documents/menuItems?key=' + encodeURIComponent(cfg.apiKey);
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
    }).then(parseMenuItemsFromRest).catch(function (err) {
        if (timer) clearTimeout(timer);
        if (isFirestoreApiDisabledError(err)) showFirestoreApiDisabledAlert();
        throw err;
    });
}

function menuItemsSignature(items) {
    if (!items || !items.length) return '';
    return items.map(function (i) {
        return i.id + '|' + (i.available === false ? '0' : '1') + '|' + (i.price || 0) +
            '|' + (i.category || '') + '|' + (i.image || '') +
            '|' + (i.name_ku || '') + '|' + (i.name_ar || '') + '|' + (i.name_en || '');
    }).sort().join(';');
}

function computeCategoryBarSig(categories, items, lang) {
    var prefix = isEmenuPage() ? 'all|' : '';
    if (categories.length > 0) {
        return prefix + categories.map(function (c) { return c.id; }).join('|') + '|' + lang;
    }
    var found = items.length > 0
        ? new Set(items.map(function (i) { return i.category; }).filter(Boolean).filter(function (c) { return c !== 'Water'; }))
        : new Set();
    return prefix + 'fb|' + Array.from(found).sort().join('|') + '|' + lang;
}

async function loadCategoriesFromFirebase() {
    if (!window.db) return false;
    if (window._firestoreApiDisabled) return false;
    try {
        const catSnap = await firestoreGetWithTimeout(window.db.collection('categories'), 8000);
        const categories = [];
        catSnap.forEach(doc => {
            categories.push({ id: doc.id, data: doc.data() });
        });
        const sig = categories.map(function (c) { return c.id; }).join('|');
        const prev = localStorage.getItem('cachedCategoriesSig') || '';
        localStorage.setItem('cachedCategories', JSON.stringify(categories));
        localStorage.setItem('cachedCategoriesSig', sig);
        if (cachedMenuItems.length > 0) {
            renderCategories(cachedMenuItems, { autoSelect: false, forceRebuild: true });
        }
        return prev !== sig;
    } catch (e) {
        console.error('Error loading categories:', e);
        if (isFirestoreApiDisabledError(e)) {
            showFirestoreApiDisabledAlert();
        }
        return false;
    }
}

function applyMenuItemsUpdate(items, options) {
    options = options || {};
    const sig = menuItemsSignature(items);
    if (sig === _lastMenuItemsSignature && !options.force && !menuStillLoading()) return;
    _lastMenuItemsSignature = sig;

    cachedMenuItems = items;
    localStorage.setItem('cachedMenuItems', JSON.stringify(items));

    const container = document.getElementById('menuGrid');
    if (!container) return;

    clearMenuLoadingSpinner();

    if (!_menuUiReady || menuStillLoading()) {
        paintMenuFromItems(items, { autoSelect: true });
        return;
    }

    const scroll = document.getElementById('categoryScroll');
    const prevCatSig = scroll ? scroll.dataset.categorySig : '';
    renderCategories(items, { autoSelect: false, forceRebuild: false });
    const catBarChanged = scroll && scroll.dataset.categorySig !== prevCatSig;

    if (catBarChanged) {
        autoSelectCategoryAfterRender(true);
    } else if (_activeCategory) {
        switchCategory(_activeCategory, { silent: true });
    } else if (items.length > 0) {
        autoSelectCategoryAfterRender(true);
    } else {
        container.innerHTML = '';
    }
    setupCategoryScrollSpy();
}

function showCachedMenuIfAvailable() {
    const cached = localStorage.getItem('cachedMenuItems');
    if (!cached) return false;

    try {
        const items = normalizeMenuItemsList(JSON.parse(cached));
        if (!items.length) return false;
        console.log('Shown from cache:', items.length);
        return paintMenuFromItems(items, { autoSelect: true });
    } catch (e) {
        console.error('Error parsing cache:', e);
        return false;
    }
}

async function loadMenuItems() {
    if (loadMenuItems._inProgress) return;
    loadMenuItems._inProgress = true;

    const container = document.getElementById('menuGrid');
    const lang = localStorage.getItem('selectedLang') || 'ku';
    const strings = i18n[lang] || i18n.en;
    if (!container) {
        loadMenuItems._inProgress = false;
        return;
    }

    if (window.location && window.location.search && /[?&]refreshCache(?:=1)?(&|$)/.test(window.location.search)) {
        [
            'cachedMenuItems',
            'cachedMenuItemsSig',
            'cachedCategories',
            'cachedCategoriesSig'
        ].forEach(function(key) { localStorage.removeItem(key); });
    }

    const hadCache = showCachedMenuIfAvailable();
    if (!hadCache) {
        container.innerHTML = '<div class="loading-menu">' + strings.loadingMenu +
            '<br><small style="opacity:0.45;font-size:0.75rem;margin-top:6px;display:block">' + APP_VERSION + '</small></div>';
    }

    if (USE_LOCAL_API) {
        localApiRequest('menu_items.php').then(function(items) {
            if (loadMenuItems._loadTimer) {
                clearTimeout(loadMenuItems._loadTimer);
                loadMenuItems._loadTimer = null;
            }
            applyMenuItemsUpdate(items, { force: true });
        }).catch(function(err) {
            console.warn('[menu] Local API load failed:', err.message);
            if (!hadCache && !_menuUiReady) {
                var container = document.getElementById('menuGrid');
                if (container) {
                    container.innerHTML = '<div class="empty-state">' +
                        '<div class="empty-state-icon">⚠️</div>' +
                        '<p>' + (strings.errorLoadingMenu || 'Error loading menu') + '</p>' +
                        '<p style="font-size:0.8rem;opacity:0.7;margin-top:8px;">' + (err.message || 'Check connection') + '</p>' +
                        '<button type="button" class="menu-retry-btn" id="menuRetryBtn">' + (strings.menuLoadRetry || 'Retry') + '</button>' +
                    '</div>';
                    var retry = document.getElementById('menuRetryBtn');
                    if (retry) {
                        retry.addEventListener('click', function () {
                            loadMenuItems._inProgress = false;
                            loadMenuItems();
                        });
                    }
                }
            }
        });
        loadMenuItems._inProgress = false;
        return;
    }

    if (loadMenuItems._loadTimer) clearTimeout(loadMenuItems._loadTimer);
    loadMenuItems._loadTimer = setTimeout(function () {
        if (menuStillLoading()) {
            fetchMenuViaRest(12000).then(function (items) {
                applyMenuItemsUpdate(items, { force: true });
            }).catch(function () {
                fetchMenuItemsFallback(strings, 'timeout');
            });
        }
    }, 4000);

    // REST fetch runs immediately — bypasses Firestore SDK when it hangs on mobile hosts.
    fetchMenuViaRest(10000).then(function (items) {
        if (loadMenuItems._loadTimer) {
            clearTimeout(loadMenuItems._loadTimer);
            loadMenuItems._loadTimer = null;
        }
        applyMenuItemsUpdate(items, { force: true });
    }).catch(function (err) {
        console.warn('[menu] REST load failed:', err.message);
        if (isFirestoreApiDisabledError(err)) {
            showFirestoreApiDisabledAlert();
        }
        if (!hadCache && !_menuUiReady) {
            var container = document.getElementById('menuGrid');
            if (container) {
                container.innerHTML = '<div class="empty-state">' +
                    '<div class="empty-state-icon">⏳</div>' +
                    '<p>' + (strings.loadingMenu || 'Loading menu...') + '</p>' +
                    '<p style="font-size:0.8rem;opacity:0.7;margin-top:8px;">' + (strings.menuConnectionHint || 'Check connection') + '</p>' +
                    '<button type="button" class="menu-retry-btn" id="menuRetryBtn">' + (strings.menuLoadRetry || 'Retry') + '</button>' +
                '</div>';
                var retry = document.getElementById('menuRetryBtn');
                if (retry) {
                    retry.addEventListener('click', function () {
                        loadMenuItems._inProgress = false;
                        loadMenuItems();
                    });
                }
            }
        }
    });

    try {
        await waitForFirebaseDb(8000);

        // Do not block menu on categories — load in background.
        loadCategoriesFromFirebase().then(function (categoriesChanged) {
            if (categoriesChanged && cachedMenuItems.length > 0) {
                renderCategories(cachedMenuItems, { autoSelect: false, forceRebuild: true });
            }
        }).catch(function () {});

        // Primary path: one-shot fetch (works when onSnapshot hangs on mobile hosts).
        fetchMenuItemsFallback(strings, 'initial-get');

        if (loadMenuItems._unsubscribe) loadMenuItems._unsubscribe();
        loadMenuItems._unsubscribe = window.db.collection('menuItems').onSnapshot(
            liveSnap => {
                if (loadMenuItems._loadTimer) {
                    clearTimeout(loadMenuItems._loadTimer);
                    loadMenuItems._loadTimer = null;
                }
                applyMenuItemsUpdate(parseMenuItemsFromSnapshot(liveSnap));
            },
            err => {
                console.warn('[realtime] error:', err.message);
                handleMenuLoadFailure(err, strings);
            }
        );

        if (window._categoriesUnsubscribe) window._categoriesUnsubscribe();
        window._categoriesUnsubscribe = window.db.collection('categories').onSnapshot(
            snap => {
                const cats = [];
                snap.forEach(doc => cats.push({ id: doc.id, data: doc.data() }));
                localStorage.setItem('cachedCategories', JSON.stringify(cats));
                const sig = cats.map(c => c.id).join('|');
                const prev = localStorage.getItem('cachedCategoriesSig') || '';
                localStorage.setItem('cachedCategoriesSig', sig);
                if (cachedMenuItems && cachedMenuItems.length > 0) {
                    renderCategories(cachedMenuItems, { autoSelect: false, forceRebuild: true });
                }
            },
            err => console.warn('[realtime categories] error:', err.message)
        );
    } catch (error) {
        console.error('Error loading menu:', error);
        handleMenuLoadFailure(error, strings, hadCache);
    } finally {
        loadMenuItems._inProgress = false;
    }
}

function handleMenuLoadFailure(error, strings, hadCache) {
    loadFromCache();
    if (_menuUiReady && !menuStillLoading()) return;
    if (isFirestoreApiDisabledError(error)) {
        showFirestoreApiDisabledAlert();
    }
    showMenuLoadError(strings, error);
    fetchMenuItemsFallback(strings, 'snapshot-failed');
}

function showMenuLoadError(strings, error) {
    var container = document.getElementById('menuGrid');
    if (!container || (_menuUiReady && !menuStillLoading())) return;
    var msg = (error && error.message) ? error.message : '';
    if (msg.indexOf('permission') !== -1 || msg.indexOf('Missing or insufficient') !== -1) {
        msg = strings.menuConnectionHint;
    } else if (msg.indexOf('timeout') !== -1 || msg.indexOf('Timeout') !== -1) {
        msg = strings.menuConnectionHint;
    }
    if (!msg && window.location && window.location.hostname) {
        msg = strings.menuConnectionHint + ' (' + window.location.hostname + ')';
    }
    container.innerHTML =
        '<div class="empty-state">' +
            '<div class="empty-state-icon">⚠️</div>' +
            '<p>' + strings.errorLoadingMenu + '</p>' +
            (msg ? '<p style="font-size:0.8rem;margin-top:8px;opacity:0.85">' + msg + '</p>' : '') +
            '<button type="button" class="menu-retry-btn" id="menuRetryBtn">' + strings.menuLoadRetry + '</button>' +
        '</div>';
    var retry = document.getElementById('menuRetryBtn');
    if (retry) {
        retry.addEventListener('click', function () {
            loadMenuItems._inProgress = false;
            loadMenuItems();
        });
    }
    renderCategories([], { forceRebuild: true, autoSelect: false });
}

function fetchMenuItemsFallback(strings, reason) {
    if (window._firestoreApiDisabled) return;
    if (_menuUiReady && !menuStillLoading()) return;
    fetchMenuViaRest(10000).then(function (items) {
        if (loadMenuItems._loadTimer) {
            clearTimeout(loadMenuItems._loadTimer);
            loadMenuItems._loadTimer = null;
        }
        applyMenuItemsUpdate(items, { force: true });
    }).catch(function (restErr) {
        console.warn('[menu] REST fallback failed (' + reason + '):', restErr.message);
        if (!window.db) {
            if (!_menuUiReady) showMenuLoadError(strings, restErr);
            return;
        }
        firestoreGetWithTimeout(window.db.collection('menuItems'), 8000).then(function (snap) {
            if (loadMenuItems._loadTimer) {
                clearTimeout(loadMenuItems._loadTimer);
                loadMenuItems._loadTimer = null;
            }
            applyMenuItemsUpdate(parseMenuItemsFromSnapshot(snap), { force: true });
        }).catch(function (err) {
            console.warn('[menu] SDK fallback get failed (' + reason + '):', err.message);
            if (!_menuUiReady) showMenuLoadError(strings, err);
        });
    });
}

function loadFromCache() {
    var strings = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var container = document.getElementById('menuGrid');
    if (!container) return;

    var cached = localStorage.getItem('cachedMenuItems');
    if (cached) {
        try {
            var items = normalizeMenuItemsList(JSON.parse(cached));
            if (items.length > 0) {
                console.log('Loaded from cache:', items.length);
                paintMenuFromItems(items, { autoSelect: true });
                return;
            }
            clearMenuLoadingSpinner();
            container.innerHTML = '';
        } catch (e) {
            console.error('Error parsing cache:', e);
            container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⚠️</div><p>' + strings.errorLoadingMenu + '</p>';
        }
    } else {
        clearMenuLoadingSpinner();
        container.innerHTML = '';
    }
}

window.addEventListener('pagehide', function () {
    if (loadMenuItems._unsubscribe) loadMenuItems._unsubscribe();
});

function isEmenuPage() {
    return document.body.classList.contains('emenu-layout');
}

function allCategoryIconSvg() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
        '<path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4l1.4-1.4M17 7l1.4-1.4"/>' +
        '<circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>' +
        '</svg>';
}

function buildAllCategoryButton(label) {
    return '<button class="category-btn category-btn-all" data-category="' + ALL_CATEGORY_ID + '">' +
        '<span class="cat-all-mark" aria-hidden="true">' + allCategoryIconSvg() + '</span>' +
        '<span class="cat-label">' + label + '</span></button>';
}

function filterItemsByCategory(items, category) {
    if (category === ALL_CATEGORY_ID) return items;
    var cachedCats = localStorage.getItem('cachedCategories');
    if (cachedCats) {
        try {
            var categories = JSON.parse(cachedCats);
            if (categories.some(function (c) { return c.id === category; })) {
                return items.filter(function (i) { return i.category === category; });
            }
        } catch (e) {}
    }
    return items.filter(function (i) { return i.category === category; });
}

function renderCategories(items, options) {
     options = options || {};
     const scroll = document.getElementById('categoryScroll');
     if (!scroll) return;

     const lang = localStorage.getItem('selectedLang') || 'ku';
     const strings = i18n[lang] || i18n.en;
     const allBtn = isEmenuPage() ? buildAllCategoryButton(strings.allItems) : '';

     // Load categories from Firebase or cache
     const cachedCats = localStorage.getItem('cachedCategories');
     let categories = [];
     if (cachedCats) {
         try {
             categories = JSON.parse(cachedCats);
         } catch (e) {
             console.error('Error parsing cached categories:', e);
         }
     }

      // Merge item categories into the menu category list so any category used by items
      // is shown even if there is no matching categories document or the IDs differ.
      const existingIds = new Set(categories.map(c => c.id));
      items.forEach(item => {
          const cat = item.category;
          if (!cat || cat === 'Water' || existingIds.has(cat)) return;
          existingIds.add(cat);
          categories.push({
              id: cat,
              data: { name_ku: cat, name_ar: cat, name_en: cat, image: '' }
          });
      });

       categories.sort(function (a, b) {
           var ai = PREFERRED_CATEGORY_ORDER.indexOf(a.id);
           var bi = PREFERRED_CATEGORY_ORDER.indexOf(b.id);
           if (ai === -1 && bi === -1) return 0;
           if (ai === -1) return 1;
           if (bi === -1) return -1;
           return ai - bi;
       });

      const barSig = computeCategoryBarSig(categories, items, lang);
     if (!options.forceRebuild && scroll.dataset.categorySig === barSig) {
         if (options.autoSelect !== false) {
             autoSelectCategoryAfterRender(options.forceFirst);
         }
         return;
     }
     scroll.dataset.categorySig = barSig;

      // If no Firebase categories, use fallback
      if (categories.length === 0) {
          const categoryOrder = PREFERRED_CATEGORY_ORDER.slice();
          const foundCategories = items.length > 0 ? new Set(items.map(i => i.category).filter(Boolean).filter(c => c !== 'Water')) : new Set(categoryOrder);
          const ordered = categoryOrder.filter(c => foundCategories.has(c));
          foundCategories.forEach(c => { if (!ordered.includes(c)) ordered.push(c); });

        const categoryIcons = {
            'Coffee': '<img class="cat-icon" src="https://cdn-icons-png.flaticon.com/128/924/924514.png" alt="Coffee">',
            'Tea': '<img class="cat-icon" src="https://cdn-icons-png.flaticon.com/128/1223/1223749.png" alt="Tea">',
            'Cold Drinks': '<img class="cat-icon" src="https://cdn-icons-png.flaticon.com/128/1113/1113278.png" alt="Cold Drinks">',
            'Dessert': '<img class="cat-icon" src="https://cdn-icons-png.flaticon.com/128/8346/8346809.png" alt="Dessert">',
              'Shisha': '<img class="cat-icon" src="https://cdn-icons-png.flaticon.com/128/10170/10170651.png" alt="Shisha">',
            'Special Drinks': '<img class="cat-icon" src="https://cdn-icons-png.flaticon.com/128/5473/5473500.png" alt="Special Drinks">',
        };

         let html = allBtn;
         ordered.forEach(cat => {
             var key = cat.replace(/\s+/g, '');
             key = key.charAt(0).toLowerCase() + key.slice(1);
             var label = strings[key] || cat;
             var icon = categoryIcons[cat] || '<svg class="cat-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/></svg>';
             html += `<button class="category-btn" data-category="${cat}">${icon}<span class="cat-label">${label}</span></button>`;
         });

         scroll.innerHTML = html;

         scroll.querySelectorAll('.category-btn').forEach(btn => {
             btn.addEventListener('click', () => {
                 const cat = btn.getAttribute('data-category');
                 switchCategory(cat);
             });
         });
         if (options.autoSelect !== false) {
             autoSelectCategoryAfterRender(options.forceFirst);
         }
         return;
     }

      let html = allBtn;
      categories.forEach(cat => {
          var name = cat.data['name_' + lang] || cat.data.name_en || strings.unnamed;
          var icon = cat.data.image ? `<img class="cat-icon" src="${cat.data.image}" alt="${name}" onerror="this.onerror=null;this.src='https://cdn-icons-png.flaticon.com/128/924/924514.png'">` : '<svg class="cat-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/></svg>';
          html += `<button class="category-btn" data-category="${cat.id}">${icon}<span class="cat-label">${name}</span></button>`;
      });

     scroll.innerHTML = html;

     scroll.querySelectorAll('.category-btn').forEach(btn => {
         btn.addEventListener('click', () => {
             const cat = btn.getAttribute('data-category');
             switchCategory(cat);
         });
     });

     if (options.autoSelect !== false) {
         autoSelectCategoryAfterRender(options.forceFirst);
     }
 }

function autoSelectCategoryAfterRender(forceFirst) {
    var scroll = document.getElementById('categoryScroll');
    if (!scroll) return;
    var target = _activeCategory;
    if (forceFirst || !target) {
        target = ALL_CATEGORY_ID;
    }
    if (target) {
        var exists = scroll.querySelector('.category-btn[data-category="' + target + '"]');
        if (exists) {
            switchCategory(target, { immediate: true });
            scrollCategoryBarToActive();
        } else if (scroll.querySelector('.category-btn')) {
            var firstBtn = scroll.querySelector('.category-btn');
            switchCategory(firstBtn.getAttribute('data-category'), { immediate: true });
            scrollCategoryBarToActive();
        }
    }
}

function clearCategorySelection() {
    _activeCategory = null;
    document.body.classList.remove('category-selected');
    document.body.classList.remove('category-all-active');

    var activeTitle = document.getElementById('activeCategoryTitle');
    if (activeTitle) activeTitle.textContent = '';

    document.querySelectorAll('.category-btn').forEach(function (btn) {
        btn.classList.remove('active');
    });

    // Restore the background video to how it looked before any category was picked.
    var bgVideo = document.querySelector('.bg-video');
    if (bgVideo) {
        bgVideo.style.visibility = '';
        var playPromise = bgVideo.play();
        if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(function () {});
        }
    }

    var grid = document.getElementById('menuGrid');
    if (grid) {
        grid.classList.add('category-switching');
        setTimeout(function () {
            grid.innerHTML = '';
            grid.classList.remove('category-switching');
        }, 150);
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function switchCategory(category, options) {
    options = options || {};
    if (_activeCategory === category) {
        if (options.silent || options.immediate || menuStillLoading()) {
            renderMenuItems(filterItemsByCategory(cachedMenuItems, category));
            renderMenuCardsWithFeatures();
            return;
        }
        if (!document.body.classList.contains('emenu-layout')) {
            clearCategorySelection();
        }
        return;
    }

    _activeCategory = category;
    document.body.classList.add('category-selected');
    document.body.classList.toggle('category-all-active', category === ALL_CATEGORY_ID);

    var activeTitle = document.getElementById('activeCategoryTitle');
    if (activeTitle) {
        activeTitle.textContent = getCategoryDisplayName(category);
    }

    document.querySelectorAll('.category-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-category') === category);
    });

    scrollCategoryBarToActive();

    const grid = document.getElementById('menuGrid');
    if (!grid) return;

    if (options.silent || options.immediate) {
        renderMenuItems(filterItemsByCategory(cachedMenuItems, category));
        renderMenuCardsWithFeatures();
        return;
    }

    grid.classList.add('category-switching');

    setTimeout(() => {
        renderMenuItems(filterItemsByCategory(cachedMenuItems, category));
        renderMenuCardsWithFeatures();
        grid.classList.remove('category-switching');
    }, 200);

    if (options.immediate) return;
    var targetSection = document.getElementById('category-section-' + category);
    if (targetSection) {
        setTimeout(function () {
            targetSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 250);
    } else {
        var gridTop = grid.getBoundingClientRect().top + window.scrollY - 100;
        window.scrollTo({ top: gridTop, behavior: 'smooth' });
    }
}

function scrollCategoryBarToActive() {
    var scroll = document.getElementById('categoryScroll');
    if (!scroll) return;
    var activeBtn = scroll.querySelector('.category-btn.active');
    if (!activeBtn) return;
    if (scroll.scrollWidth <= scroll.clientWidth) return;
    var scrollLeft = activeBtn.offsetLeft - (scroll.clientWidth / 2) + (activeBtn.clientWidth / 2);
    scroll.scrollTo({ left: scrollLeft, behavior: 'smooth' });
}

function setupCategoryScrollSpy() {
    if (window._categoryScrollSpy) return;
    window._categoryScrollSpy = true;

    var sections = [];
    var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            var cat = entry.target.getAttribute('data-category-section');
            if (!cat) return;
            document.querySelectorAll('.category-btn').forEach(function (btn) {
                btn.classList.toggle('active', btn.getAttribute('data-category') === cat);
            });
            scrollCategoryBarToActive();
        });
    }, {
        root: null,
        rootMargin: '-20% 0px -60% 0px',
        threshold: 0
    });

    function observeSections() {
        sections.forEach(function (s) { observer.unobserve(s); });
        sections = [];
        document.querySelectorAll('[data-category-section]').forEach(function (el) {
            sections.push(el);
            observer.observe(el);
        });
    }

    window._observeCategorySections = observeSections;
    observeSections();
}

/* ========================================
   Menu Items Rendering
   ======================================== */

/* ========================================
   Menu Items Rendering
   ======================================== */

function createMenuCard(item, lang, strings) {
    const card = document.createElement('div');
    card.className = 'menu-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('data-item-id', item.id);

    const name = item[`name_${lang}`] || item.name_en || item.name_ar || item.name_ku || 'Unnamed Item';
    const description = item[`description_${lang}`] || item.description_en || item.description_ar || item.description_ku || '';
    const fallbackImage = 'data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27400%27 height=%27300%27%3E%3Crect fill=%231a1a1a width=%27400%27 height=%27300%27/%3E%3Ctext x=%2750%25%27 y=%2750%25%27 font-size=%2740%27 text-anchor=%27middle%27 dy=%27.3em%27 fill=%23D4AF37%27%3E%E2%98%95%3C/text%3E%3C/svg%3E';
    const imageUrl = normalizeImageUrl(item.image) || fallbackImage;

    let categoryName = '';
    const cachedCats = localStorage.getItem('cachedCategories');
    if (cachedCats && item.category) {
        try {
            const categories = JSON.parse(cachedCats);
            const cat = categories.find(c => c.id === item.category);
            if (cat) {
                categoryName = cat.data['name_' + lang] || cat.data.name_en || '';
            }
        } catch (e) {}
    }
    if (!categoryName && item.category) {
        const key = item.category.replace(/\s+/g, '');
        const lookupKey = key.charAt(0).toLowerCase() + key.slice(1);
        categoryName = strings[lookupKey] || item.category;
    }

    const isEmenu = document.body.classList.contains('emenu-layout');
    const priceText = isEmenu
        ? (item.price ? item.price.toLocaleString() : '0') + ' د.ع'
        : (item.price ? item.price.toLocaleString() : '0') + ' IQD';

    if (isEmenu) {
        card.innerHTML = `
            <div class="menu-card-img-wrapper">
                <img src="${imageUrl}" alt="${name}" class="menu-card-img" loading="lazy"
                     onerror="this.onerror=null;this.src='${fallbackImage}';">
                <span class="menu-card-price-badge">${priceText}</span>
            </div>
            <div class="menu-card-foot">
                <span class="menu-card-foot-title">${name}</span>
                <button class="menu-card-cart" data-item-id="${item.id}" aria-label="Add to Cart">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                        <circle cx="9" cy="21" r="1"></circle>
                        <circle cx="20" cy="21" r="1"></circle>
                        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
                    </svg>
                </button>
            </div>
        `;
    } else {
        card.innerHTML = `
            <div class="menu-card-img-wrapper">
                <img src="${imageUrl}" alt="${name}" class="menu-card-img" loading="lazy"
                     onerror="this.onerror=null;this.src='${fallbackImage}';">
                <div class="menu-card-badge">${categoryName}</div>
            </div>
            <div class="menu-card-body">
                <h2 class="menu-card-title">${name}</h2>
                ${description ? `<p class="menu-card-desc">${description}</p>` : '<p class="menu-card-desc" style="opacity:0">—</p>'}
                <div class="menu-card-footer">
                    <div class="price-tag">
                        ${item.price ? item.price.toLocaleString() : '0'}
                        <span class="price-currency">IQD</span>
                    </div>
                    <button class="menu-card-cart" data-item-id="${item.id}" aria-label="Add to Cart">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="9" cy="21" r="1"></circle>
                            <circle cx="20" cy="21" r="1"></circle>
                            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    }

    const openDetail = () => openProductDetail(item);
    card.addEventListener('click', openDetail);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(); } });

    const cartBtn = card.querySelector('.menu-card-cart');
    if (cartBtn) {
        cartBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            addToCart(item);
            cartBtn.classList.add('added');
            setTimeout(() => cartBtn.classList.remove('added'), 600);
        });
    }

    return card;
}

function appendCategorySection(container, catId, catItems, lang, strings) {
    const section = document.createElement('div');
    section.className = 'category-section';
    section.setAttribute('data-category-section', catId);
    section.id = 'category-section-' + catId;

    const header = document.createElement('div');
    header.className = 'category-section-header';
    header.textContent = getCategoryDisplayName(catId, lang);
    section.appendChild(header);

    catItems.forEach(item => section.appendChild(createMenuCard(item, lang, strings)));
    return section;
}

function renderMenuItems(items) {
    const container = document.getElementById('menuGrid');
    if (!container) return;

    _renderSerial++;
    const lang = localStorage.getItem('selectedLang') || 'ku';
    const strings = i18n[lang] || i18n.en;

    container.innerHTML = '';

    if (!items || items.length === 0) {
        container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">☕</div><p>${strings.noCategoryItems}</p></div>`;
        return;
    }

    const availableItems = items.filter(item => item.available !== false);

    // Grouped "All" view: render items inside category sections
    if (_activeCategory === ALL_CATEGORY_ID && availableItems.length > 0) {
        const groups = {};
        availableItems.forEach(item => {
            const cat = item.category || '__uncategorized';
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(item);
        });

        let categoryOrder = [];
        try {
            const cachedCats = JSON.parse(localStorage.getItem('cachedCategories') || '[]');
            cachedCats.forEach(function (c) {
                if (c.id && categoryOrder.indexOf(c.id) === -1) categoryOrder.push(c.id);
            });
        } catch (e) {}

        Object.keys(groups).forEach(function (catId) {
            if (catId && categoryOrder.indexOf(catId) === -1) categoryOrder.push(catId);
        });

        categoryOrder.forEach(catId => {
            if (!groups[catId]) return;
            const section = document.createElement('div');
            section.className = 'category-section';
            section.setAttribute('data-category-section', catId);
            section.id = 'category-section-' + catId;

            const heading = document.createElement('h3');
            heading.className = 'category-heading';
            heading.textContent = getCategoryDisplayName(catId, lang);
            section.appendChild(heading);

            const itemsByGroup = {};
            groups[catId].forEach(item => {
                const g = item.group || '__ungrouped';
                if (!itemsByGroup[g]) itemsByGroup[g] = [];
                itemsByGroup[g].push(item);
            });

            const groupOrder = Object.keys(itemsByGroup);
            groupOrder.forEach(g => {
                if (g === '__ungrouped') {
                    itemsByGroup[g].forEach(item => section.appendChild(createMenuCard(item, lang, strings)));
                    return;
                }
                const groupHeading = document.createElement('h4');
                groupHeading.className = 'group-heading';
                groupHeading.textContent = g;
                section.appendChild(groupHeading);
                itemsByGroup[g].forEach(item => section.appendChild(createMenuCard(item, lang, strings)));
            });

            container.appendChild(section);
        });

        if (window._observeCategorySections) window._observeCategorySections();
        return;
    }

    // Flat rendering (single category or legacy path)
    if (availableItems.length > 0) {
        const section = document.createElement('div');
        section.className = 'category-section';
        section.setAttribute('data-category-section', _activeCategory);
        section.id = 'category-section-' + _activeCategory;

        const heading = document.createElement('h3');
        heading.className = 'category-heading';
        heading.textContent = getCategoryDisplayName(_activeCategory, lang);
        section.appendChild(heading);

        const itemsByGroup = {};
        availableItems.forEach(item => {
            const g = item.group || '__ungrouped';
            if (!itemsByGroup[g]) itemsByGroup[g] = [];
            itemsByGroup[g].push(item);
        });

        const groupOrder = Object.keys(itemsByGroup);
        groupOrder.forEach(g => {
            if (g === '__ungrouped') {
                itemsByGroup[g].forEach(item => section.appendChild(createMenuCard(item, lang, strings)));
                return;
            }
            const groupHeading = document.createElement('h4');
            groupHeading.className = 'group-heading';
            groupHeading.textContent = g;
            section.appendChild(groupHeading);
            itemsByGroup[g].forEach(item => section.appendChild(createMenuCard(item, lang, strings)));
        });

        container.appendChild(section);
    }
}

/* ========================================
   Product Detail Modal
   ======================================== */

var _detailScrollY = 0;

function lockPageScroll() {
    _detailScrollY = window.scrollY || window.pageYOffset || 0;
    document.body.style.position = 'fixed';
    document.body.style.top = '-' + _detailScrollY + 'px';
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
}

function unlockPageScroll() {
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.width = '';
    window.scrollTo(0, _detailScrollY);
}

function getCategoryDisplayName(categoryId, lang) {
    if (!categoryId) return '';
    lang = lang || localStorage.getItem('selectedLang') || 'ku';
    var strings = i18n[lang] || i18n.en;
    if (categoryId === ALL_CATEGORY_ID) return strings.allItems;
    var cachedCats = localStorage.getItem('cachedCategories');
    if (cachedCats) {
        try {
            var categories = JSON.parse(cachedCats);
            var cat = categories.find(function (c) { return c.id === categoryId; });
            if (cat) return cat.data['name_' + lang] || cat.data.name_en || categoryId;
        } catch (e) {}
    }
    var key = categoryId.replace(/\s+/g, '');
    key = key.charAt(0).toLowerCase() + key.slice(1);
    return strings[key] || categoryId;
}

function openProductDetail(item) {
    _currentDetailItem = item;
    const lang = localStorage.getItem('selectedLang') || 'ku';
    const name = item[`name_${lang}`] || item.name_en || item.name_ar || item.name_ku || 'Unnamed Item';
    const description = item[`description_${lang}`] || item.description_en || item.description_ar || item.description_ku || '';
    const fallbackImage = 'data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27400%27 height=%27300%27%3E%3Crect fill=%231a1a1a width=%27400%27 height=%27300%27/%3E%3Ctext x=%2750%25%27 y=%2750%25%27 font-size=%2740%27 text-anchor=%27middle%27 dy=%27.3em%27 fill=%23D4AF37%27%3E%E2%98%95%3C/text%3E%3C/svg%3E';
    const imageUrl = normalizeImageUrl(item.image) || fallbackImage;

    // Populate detail panel
    const imgEl = document.getElementById('detailImage');
    if (imgEl) imgEl.src = imageUrl;

    const catEl = document.getElementById('detailCategory');
    if (catEl) catEl.textContent = getCategoryDisplayName(item.category, lang);

    const titleEl = document.getElementById('detailTitle');
    if (titleEl) titleEl.textContent = name;

    const descEl = document.getElementById('detailDesc');
    if (descEl) descEl.textContent = description;

    const priceEl = document.getElementById('detailPrice');
    if (priceEl) priceEl.textContent = item.price ? item.price.toLocaleString() : '0';

    // Video button
    const videoBtn = document.getElementById('videoPlayBtn');
    if (videoBtn) {
        if (item.video) {
            videoBtn.style.display = 'flex';
            videoBtn.onclick = () => openVideoModal(item.video);
        } else {
            videoBtn.style.display = 'none';
        }
    }

    // Show overlay
    const overlay = document.getElementById('detailOverlay');
    if (overlay) {
        if (overlay.parentElement !== document.body) {
            document.body.appendChild(overlay);
        }
        overlay.classList.add('open');
        document.body.classList.add('detail-open');
        lockPageScroll();
        overlay.scrollTop = 0;
    }
}

function closeProductDetail() {
    const overlay = document.getElementById('detailOverlay');
    if (overlay) {
        overlay.classList.remove('open');
        document.body.classList.remove('detail-open');
        unlockPageScroll();
    }
    _currentDetailItem = null;
}

/* ========================================
   Video Modal
   ======================================== */

function openVideoModal(videoUrl) {
    const overlay = document.getElementById('videoOverlay');
    const videoEl = document.getElementById('detailVideo');
    if (!overlay || !videoEl) return;

    videoEl.src = videoEl.src = videoUrl;
    videoEl.play().catch(() => {});
    overlay.classList.add('open');
}

function closeVideoModal() {
    const overlay = document.getElementById('videoOverlay');
    const videoEl = document.getElementById('detailVideo');
    if (overlay) overlay.classList.remove('open');
    if (videoEl) {
        videoEl.pause();
        videoEl.src = '';
    }
}

/* ========================================
   Event Wiring (menu page)
   ======================================== */

document.addEventListener('DOMContentLoaded', function () {
    // Initialize cart
    loadCart();
    updateCartBadge();

    // Initialize language dropdown
    var currentLang = localStorage.getItem('selectedLang') || 'ku';
    var currentLangLabel = document.getElementById('currentLangLabel');
    if (currentLangLabel) {
        currentLangLabel.textContent = currentLang.toUpperCase();
    }
    document.querySelectorAll('.lang-option').forEach(function(option) {
        option.classList.toggle('active', option.getAttribute('data-lang') === currentLang);
    });

    // Cart button
    var cartBtn = document.getElementById('cartBtn');
    if (cartBtn) {
        cartBtn.addEventListener('click', openCartPanel);
    }

    var cartClose = document.getElementById('cartClose');
    if (cartClose) {
        cartClose.addEventListener('click', closeCartPanel);
    }

    var cartOverlay = document.getElementById('cartOverlay');
    if (cartOverlay) {
        cartOverlay.addEventListener('click', function(e) {
            if (e.target === cartOverlay) closeCartPanel();
        });
    }

    var cartClear = document.getElementById('cartClear');
    if (cartClear) {
        cartClear.addEventListener('click', function() {
            clearCart();
            renderCartItems();
        });
    }

    var cartWhatsapp = document.getElementById('cartWhatsapp');
    if (cartWhatsapp) {
        cartWhatsapp.addEventListener('click', function() {
            sendWhatsAppOrder();
        });
    }

    var cartLocationBtn = document.getElementById('cartLocationBtn');
    if (cartLocationBtn) {
        cartLocationBtn.addEventListener('click', function() {
            useCurrentLocation();
        });
    }

    setupCartFormValidation();

    setupCafeInfoPanel();

    // Detail close
    var detailBackdrop = document.getElementById('detailBackdrop');
    var detailClose = document.getElementById('detailClose');
    if (detailBackdrop) detailBackdrop.addEventListener('click', closeProductDetail);
    if (detailClose) detailClose.addEventListener('click', closeProductDetail);

    // Video close
    var videoOverlay = document.getElementById('videoOverlay');
    var videoClose = document.getElementById('videoClose');
    if (videoOverlay) videoOverlay.addEventListener('click', function (e) { if (e.target === this) closeVideoModal(); });
    if (videoClose) videoClose.addEventListener('click', closeVideoModal);

    // Escape key
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            var videoOverlay = document.getElementById('videoOverlay');
            if (videoOverlay && videoOverlay.classList.contains('open')) {
                closeVideoModal();
            } else {
                closeInstallTutorial();
                closeCafeInfoPanel();
                closeProductDetail();
                closeCartPanel();
            }
        }
    });
});

/* ========================================
   Language
   ======================================== */

function setActiveLanguage(lang) {
    localStorage.setItem('selectedLang', lang);

    if (window.location.pathname.includes('menu.html')) {
        const url = new URL(window.location);
        url.searchParams.set('lang', lang);
        window.history.pushState({ path: url.href }, '', url.href);
    }

    // Update old buttons
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-lang') === lang);
    });

    // Update new dropdown
    var currentLangLabel = document.getElementById('currentLangLabel');
    if (currentLangLabel) {
        currentLangLabel.textContent = lang.toUpperCase();
    }

    document.querySelectorAll('.lang-option').forEach(function(option) {
        option.classList.toggle('active', option.getAttribute('data-lang') === lang);
    });

    document.documentElement.dir = (lang === 'ar' || lang === 'ku') ? 'rtl' : 'ltr';
}

function applyLanguageUI(lang) {
    var strings = i18n[lang] || i18n.en;
    document.title = strings.pageTitle;

    document.querySelectorAll('[data-i18n]').forEach(function (element) {
        if (element.closest('#menuHeroBrand')) return;
        if (element.id === 'cafeHoursText') return;
        var key = element.getAttribute('data-i18n');
        if (strings[key]) element.textContent = strings[key];
    });

    if (window.location.pathname.includes('admin.html')) {
        updateAdminPanelText(strings);
        var activeSection = document.querySelector('.admin-nav-btn.active');
        if (activeSection) {
            var section = activeSection.getAttribute('data-section');
            loadAdminSection(section);
        }
    }

    if (cachedMenuItems.length > 0) {
        renderCategories(cachedMenuItems, { forceRebuild: true, autoSelect: false });
        if (_activeCategory) {
            switchCategory(_activeCategory, { silent: true });
        } else {
            autoSelectCategoryAfterRender();
        }
    }

    if (_currentDetailItem) {
        openProductDetail(_currentDetailItem);
    }

    updateCafeInfoPanel();
    updateInstallHelpLabel();
}

function updateAdminPanelText(strings) {
    var navMap = {
        dashboard: strings.dashboard,
        items: strings.manageItems,
        categories: strings.manageCategories,
        cashier: strings.cashier,
        expenses: strings.expenses,
        settings: strings.settings,
        logout: strings.logout
    };
    var activeBtn = document.querySelector('.admin-nav-btn.active');
    var adminHeader = document.querySelector('.admin-header h1');
    if (adminHeader && activeBtn) {
        var activeSection = activeBtn.getAttribute('data-section');
        if (navMap[activeSection]) adminHeader.textContent = navMap[activeSection];
    }
    document.querySelectorAll('.admin-nav-btn').forEach(function (item) {
        var section = item.getAttribute('data-section');
        if (navMap[section]) {
            var label = item.querySelector('span:last-child');
            if (label) label.textContent = navMap[section];
        }
    });
}

function setupLanguageButtons() {
    // New language dropdown
    var langDropdownBtn = document.getElementById('langDropdownBtn');
    var langDropdownMenu = document.getElementById('langDropdownMenu');
    var langDropdown = document.getElementById('langDropdown');
    var currentLangLabel = document.getElementById('currentLangLabel');

    if (langDropdownBtn && langDropdownMenu) {
        langDropdownBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            var themeDropdown = document.getElementById('themeDropdown');
            if (themeDropdown) themeDropdown.classList.remove('open');
            langDropdown.classList.toggle('open');
        });

        langDropdownMenu.querySelectorAll('.lang-option').forEach(function(option) {
            option.addEventListener('click', function(e) {
                e.stopPropagation();
                var lang = this.getAttribute('data-lang');
                setActiveLanguage(lang);
                applyLanguageUI(lang);
                langDropdown.classList.remove('open');
                if (currentLangLabel) {
                    currentLangLabel.textContent = lang.toUpperCase();
                }
            });
        });

        langDropdownMenu.addEventListener('click', function(e) {
            e.stopPropagation();
        });

        document.addEventListener('click', function(e) {
            if (langDropdown && !langDropdown.contains(e.target)) {
                langDropdown.classList.remove('open');
            }
        });
    }

    // Keep old buttons working for backward compatibility
    document.querySelectorAll('.lang-btn').forEach(button => {
        button.addEventListener('click', () => {
            const lang = button.getAttribute('data-lang');
            setActiveLanguage(lang);
            applyLanguageUI(lang);
        });
    });
}

/* ========================================
   Theme
   ======================================== */

function isAdminAppUi() {
    return !!(document.getElementById('adminContent') || document.querySelector('.admin-layout'));
}

function setupOfflineDetection() {
    registerServiceWorker();
    setupMenuAutoRefresh();

    window.addEventListener('online', function () {
        isOffline = false;
        if (!isAdminAppUi()) {
            scheduleMenuConnectionStatus(true);
        }
        console.log('Back online');
        if (document.getElementById('menuGrid')) {
            loadMenuItems._inProgress = false;
            loadMenuItems();
        }
    });

    window.addEventListener('offline', function () {
        isOffline = true;
        if (!isAdminAppUi()) {
            scheduleMenuConnectionStatus(false);
        }
        console.log('Gone offline');
    });

    if (isAdminAppUi()) return;

    isOffline = !navigator.onLine;
    if (isOffline) scheduleMenuConnectionStatus(false);
}

function setupMenuAutoRefresh() {
    if (!document.getElementById('menuGrid')) return;

    var lastRefreshMs = 0;
    var MIN_GAP_MS = 5000;

    function refreshMenuFromCloud() {
        if (!navigator.onLine) return;
        var now = Date.now();
        if (now - lastRefreshMs < MIN_GAP_MS) return;
        lastRefreshMs = now;

        fetchMenuViaRest(12000).then(function (items) {
            applyMenuItemsUpdate(items, { force: true });
        }).catch(function () {});

        loadCategoriesFromFirebase().then(function (categoriesChanged) {
            if (categoriesChanged && cachedMenuItems.length > 0) {
                renderCategories(cachedMenuItems, { autoSelect: false, forceRebuild: true });
            }
        }).catch(function () {});
    }

    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') refreshMenuFromCloud();
    });
    window.addEventListener('focus', refreshMenuFromCloud);
    window.addEventListener('pageshow', function (event) {
        if (event.persisted) refreshMenuFromCloud();
    });
}

var _menuStatusShowTimer = null;
var _menuStatusHideTimer = null;
var MENU_STATUS_DELAY_MS = 2000;
var MENU_STATUS_VISIBLE_MS = 3000;

function clearMenuStatusTimers() {
    if (_menuStatusShowTimer) { clearTimeout(_menuStatusShowTimer); _menuStatusShowTimer = null; }
    if (_menuStatusHideTimer) { clearTimeout(_menuStatusHideTimer); _menuStatusHideTimer = null; }
}

function hideMenuConnectionStatus() {
    var existing = document.getElementById('offlineIndicator');
    if (!existing) return;
    existing.style.opacity = '0';
    setTimeout(function () { if (existing.parentNode) existing.remove(); }, 400);
}

function scheduleMenuConnectionStatus(online) {
    clearMenuStatusTimers();
    hideMenuConnectionStatus();
    _menuStatusShowTimer = setTimeout(function () {
        _menuStatusShowTimer = null;
        showMenuConnectionStatusNow(online);
        _menuStatusHideTimer = setTimeout(function () {
            _menuStatusHideTimer = null;
            hideMenuConnectionStatus();
        }, MENU_STATUS_VISIBLE_MS);
    }, MENU_STATUS_DELAY_MS);
}

function showMenuConnectionStatusNow(online) {
    var existing = document.getElementById('offlineIndicator');
    if (existing) existing.remove();
    var lang = localStorage.getItem('selectedLang') || 'ku';
    var S = i18n[lang] || i18n.en;
    var indicator = document.createElement('div');
    indicator.id = 'offlineIndicator';
    indicator.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);color:white;padding:8px 16px;border-radius:20px;font-size:12px;font-weight:600;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.3);transition:opacity .4s ease;';
    indicator.textContent = online ? (S.backOnline || 'Back online — syncing') : S.offlineMode;
    indicator.style.background = online ? '#2E7D32' : '#C62828';
    document.body.appendChild(indicator);
}

function updateOfflineIndicator() {
    scheduleMenuConnectionStatus(!isOffline);
}

function setupThemeToggle() {
    const themeToggle = document.getElementById('themeToggle');
    const adminThemeToggle = document.getElementById('adminThemeToggle');

    if (document.body.classList.contains('emenu-layout')) {
        setupMenuThemePicker();
        return;
    }

    const savedTheme = localStorage.getItem('theme') || 'dark';

    if (savedTheme === 'light') {
        document.body.classList.add('light-mode');
    } else {
        document.body.classList.remove('light-mode');
    }

    const handleToggle = () => {
        const isLight = document.body.classList.toggle('light-mode');
        const newTheme = isLight ? 'light' : 'dark';
        localStorage.setItem('theme', newTheme);
    };

    if (themeToggle) themeToggle.addEventListener('click', handleToggle);
    if (adminThemeToggle) adminThemeToggle.addEventListener('click', handleToggle);
}

var MENU_THEMES = window.MENU_THEMES || {
    light:  { id: 'light',  light: true,  meta: '#9B6135', brown: '#9B6135', bg: '#FFFFFF', cat: '#F8F8F8', card: '#FFFFFF', surface: '#FFFFFF', pill: '#FFFFFF', fab: '#FFFFFF', text: '#1A1A1A', border: '#E8E8E8', fabText: '#5F6368' },
    cream:  { id: 'cream',  light: true,  meta: '#8B6914', brown: '#8B6914', bg: '#FAF7F2', cat: '#F0E9DF', card: '#FFFFFF', surface: '#FFFFFF', pill: '#FFFFFF', fab: '#FFFFFF', text: '#2C2416', border: '#E8DFD2', fabText: '#6B5E54' },
    coffee: { id: 'coffee', light: true,  meta: '#6F4E37', brown: '#6F4E37', bg: '#F5EDE3', cat: '#EBE0D4', card: '#FFFCF8', surface: '#FFFCF8', pill: '#FFFCF8', fab: '#FFFFFF', text: '#2A2018', border: '#DDD0C4', fabText: '#6B5344' },
    gold:   { id: 'gold',   light: true,  meta: '#B8910C', brown: '#B8910C', bg: '#FFFDF5', cat: '#FBF5E6', card: '#FFFFFF', surface: '#FFFFFF', pill: '#FFFFFF', fab: '#FFFFFF', text: '#1A1608', border: '#EDE4CC', fabText: '#6B6248' },
    mocha:  { id: 'mocha',  light: true,  meta: '#5C4033', brown: '#5C4033', bg: '#F3EBE4', cat: '#E8DDD4', card: '#FAF6F2', surface: '#FAF6F2', pill: '#FAF6F2', fab: '#FFFFFF', text: '#261A14', border: '#D9CEC4', fabText: '#6B5A50' },
    dark:   { id: 'dark',   light: false, meta: '#1A1A1A', brown: '#C4956A', bg: '#141414', cat: '#1E1E1E', card: '#2A2A2A', surface: '#2A2A2A', pill: '#2A2A2A', fab: '#333333', text: '#F0F0F0', border: '#444444', fabText: '#CFCFCF' }
};

function emenuBrownRing(hex, alpha) {
    if (window.emenuBrownRing) return window.emenuBrownRing(hex, alpha);
    alpha = alpha == null ? 0.22 : alpha;
    if (!hex || hex.charAt(0) !== '#') return 'rgba(155,97,53,' + alpha + ')';
    var h = hex.slice(1);
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var r = parseInt(h.slice(0, 2), 16);
    var g = parseInt(h.slice(2, 4), 16);
    var b = parseInt(h.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

function applyMenuTheme(themeId) {
    if (!MENU_THEMES[themeId]) themeId = 'light';
    var theme = MENU_THEMES[themeId];
    theme.id = themeId;
    var body = document.body;

    if (window.applyEmenuThemeCssVars) {
        window.applyEmenuThemeCssVars(body, theme);
    } else {
        body.setAttribute('data-menu-theme', themeId);
        body.classList.toggle('light-mode', theme.light);
        body.style.setProperty('--emenu-brown', theme.brown);
        body.style.setProperty('--heading-accent', theme.brown);
        body.style.setProperty('--heading-fg', theme.brown);
        body.style.setProperty('--emenu-bg', theme.bg);
        body.style.setProperty('--emenu-cat-bg', theme.cat);
        body.style.setProperty('--emenu-card-bg', theme.card);
        body.style.setProperty('--emenu-surface', theme.surface);
        body.style.setProperty('--emenu-pill-bg', theme.pill);
        body.style.setProperty('--emenu-fab-bg', theme.fab);
        body.style.setProperty('--emenu-text', theme.text);
        body.style.setProperty('--emenu-border', theme.border);
        body.style.setProperty('--emenu-fab-text', theme.fabText);
        body.style.setProperty('--emenu-curve', theme.bg);
        body.style.setProperty('--emenu-hero-accent', theme.brown);
        body.style.setProperty('--emenu-fab-accent', theme.brown);
        body.style.setProperty('--emenu-fab-border', theme.border);
        body.style.setProperty('--emenu-fab-accent-ring', emenuBrownRing(theme.brown, 0.22));
        body.style.setProperty('--emenu-fab-accent-ring-strong', emenuBrownRing(theme.brown, 0.38));
    }

    var heroBrand = document.getElementById('menuHeroBrand');
    if (heroBrand) {
        heroBrand.classList.remove('hero-theme-pulse');
        void heroBrand.offsetWidth;
        heroBrand.classList.add('hero-theme-pulse');
        setTimeout(function () {
            heroBrand.classList.remove('hero-theme-pulse');
        }, 900);
    }

    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme.meta);

    document.querySelectorAll('.theme-option').forEach(function (btn) {
        btn.classList.toggle('active', btn.getAttribute('data-theme') === themeId);
    });

    localStorage.setItem('menuTheme', themeId);
}

function setupMenuThemePicker() {
    var saved = localStorage.getItem('menuTheme');
    if (!saved || !MENU_THEMES[saved]) saved = 'light';
    applyMenuTheme(saved);

    var themeDropdown = document.getElementById('themeDropdown');
    var themeDropdownBtn = document.getElementById('themeDropdownBtn');
    var themeDropdownMenu = document.getElementById('themeDropdownMenu');
    var langDropdown = document.getElementById('langDropdown');

    if (themeDropdownBtn && themeDropdownMenu && themeDropdown) {
        themeDropdownBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            if (langDropdown) langDropdown.classList.remove('open');
            themeDropdown.classList.toggle('open');
        });

        themeDropdownMenu.querySelectorAll('.theme-option').forEach(function (option) {
            option.addEventListener('click', function (e) {
                e.stopPropagation();
                applyMenuTheme(this.getAttribute('data-theme'));
                themeDropdown.classList.remove('open');
            });
        });
    }

    document.addEventListener('click', function (e) {
        if (themeDropdown && !themeDropdown.contains(e.target)) {
            themeDropdown.classList.remove('open');
        }
    });
}

var HERO_TYPE_PHRASES = [
    { text: 'شاورمة الدمشقیة', dir: 'rtl' },
    { text: 'Shawarma', dir: 'ltr' }
];

function heroTypeChars(str) {
    return Array.from(str);
}

function initHeroTitleSequence() {
    var typewriter = document.getElementById('heroTypewriter');
    var typedEl = document.getElementById('heroTitleTyped');
    if (!typewriter || !typedEl) return;

    stopHeroTitleLoop();

    var phraseIndex = 0;
    var charIndex = 0;
    var isDeleting = false;
    var isIndexPage = document.body.classList.contains('index-page');
    var chars = heroTypeChars(HERO_TYPE_PHRASES[0].text);

    function typeDelay() {
        if (isDeleting) {
            return (isIndexPage ? 75 : 38) + Math.random() * (isIndexPage ? 45 : 28);
        }
        return (isIndexPage ? 120 : 68) + Math.random() * (isIndexPage ? 90 : 45);
    }

    function pauseDelay() {
        return isDeleting
            ? (isIndexPage ? 450 : 320)
            : (isIndexPage ? 2600 : 2000);
    }

    function applyPhraseMeta() {
        var phrase = HERO_TYPE_PHRASES[phraseIndex];
        typewriter.setAttribute('dir', phrase.dir);
        typedEl.setAttribute('dir', phrase.dir);
    }

    function tick() {
        var phrase = HERO_TYPE_PHRASES[phraseIndex];
        chars = heroTypeChars(phrase.text);
        applyPhraseMeta();

        if (!isDeleting) {
            charIndex += 1;
            typedEl.textContent = chars.slice(0, charIndex).join('');

            if (charIndex >= chars.length) {
                initHeroTitleSequence._timeout = setTimeout(function () {
                    isDeleting = true;
                    tick();
                }, pauseDelay());
                return;
            }
        } else {
            charIndex -= 1;
            typedEl.textContent = chars.slice(0, charIndex).join('');

            if (charIndex <= 0) {
                isDeleting = false;
                phraseIndex = (phraseIndex + 1) % HERO_TYPE_PHRASES.length;
                initHeroTitleSequence._timeout = setTimeout(tick, pauseDelay());
                return;
            }
        }

        initHeroTitleSequence._timeout = setTimeout(tick, typeDelay());
    }

    typedEl.textContent = '';
    applyPhraseMeta();
    initHeroTitleSequence._timeout = setTimeout(tick, 500);
}

function stopHeroTitleLoop() {
    if (initHeroTitleSequence._timeout) {
        clearTimeout(initHeroTitleSequence._timeout);
        initHeroTitleSequence._timeout = null;
    }
}

/* ========================================
    Cart Functions
    ======================================== */

function loadCart() {
    try {
        cartItems = JSON.parse(localStorage.getItem('cart_items') || '[]');
    } catch(e) {
        cartItems = [];
    }
}

function saveCart() {
    localStorage.setItem('cart_items', JSON.stringify(cartItems));
}

function addToCart(item) {
    var lang = localStorage.getItem('selectedLang') || 'ku';
    var name = item['name_' + lang] || item.name_en || item.name;
    var existing = cartItems.find(function(i) { return i.id === item.id; });
    
    if (existing) {
        existing.quantity += 1;
    } else {
        cartItems.push({
            id: item.id,
            name: name,
            price: item.price || 0,
            image: item.image || '',
            quantity: 1
        });
    }
    saveCart();
    updateCartBadge();
}

function removeFromCart(itemId) {
    cartItems = cartItems.filter(function(i) { return i.id !== itemId; });
    saveCart();
    updateCartBadge();
}

function updateCartQuantity(itemId, delta) {
    var item = cartItems.find(function(i) { return i.id === itemId; });
    if (item) {
        item.quantity += delta;
        if (item.quantity <= 0) {
            removeFromCart(itemId);
        } else {
            saveCart();
        }
    }
    updateCartBadge();
}

function getCartTotal() {
    return cartItems.reduce(function(sum, i) { return sum + (i.price * i.quantity); }, 0);
}

function updateCartBadge() {
    var badge = document.getElementById('cartBadge');
    var count = cartItems.reduce(function(sum, i) { return sum + i.quantity; }, 0);
    if (badge) {
        badge.textContent = count;
        badge.style.display = count > 0 ? 'flex' : 'none';
    }
}

function clearCart() {
    cartItems = [];
    saveCart();
    updateCartBadge();
}

function clearCartFormWarning() {
    var warning = document.getElementById('cartFormWarning');
    if (warning) {
        warning.textContent = '';
        warning.classList.add('hidden');
    }
    document.querySelectorAll('.cart-input.is-invalid').forEach(function (el) {
        el.classList.remove('is-invalid');
    });
}

function showCartFormWarning(message, focusEl, invalidEls) {
    var warning = document.getElementById('cartFormWarning');
    if (warning) {
        warning.textContent = message;
        warning.classList.remove('hidden');
    }
    document.querySelectorAll('.cart-input.is-invalid').forEach(function (el) {
        el.classList.remove('is-invalid');
    });
    (invalidEls || []).forEach(function (el) {
        if (el) el.classList.add('is-invalid');
    });
    if (focusEl) {
        focusEl.focus();
        focusEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

function setupCartFormValidation() {
    ['customerName', 'customerPlace'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', clearCartFormWarning);
        }
    });
}

function getCartFormLabels(lang) {
    var labels = {
        ku: {
            needName: 'تکایە ناوی خۆت بنووسە پێش ناردن بە واتساپ',
            needPlace: 'تکایە شوێنەکەت بنووسە پێش ناردن بە واتساپ',
            needBoth: 'تکایە ناو و شوێن پڕبکەرەوە پێش ناردن بە واتساپ',
            needLocation: 'تکایە لۆکەیشنەکەت بنێرە پێش ناردن بە واتساپ',
            locationNotShared: 'لۆکەیشنەکەت نەنێردراوە'
        },
        ar: {
            needName: 'الرجاء إدخال اسمك قبل الإرسال عبر واتساب',
            needPlace: 'الرجاء إدخال موقعك قبل الإرسال عبر واتساب',
            needBoth: 'الرجاء إدخال الاسم والموقع قبل الإرسال عبر واتساب',
            needLocation: 'الرجاء إرسال موقعك قبل الإرسال عبر واتساب',
            locationNotShared: 'لم يتم مشاركة الموقع'
        },
        en: {
            needName: 'Please enter your name before sending via WhatsApp',
            needPlace: 'Please enter your location before sending via WhatsApp',
            needBoth: 'Please fill in name and location before sending via WhatsApp',
            needLocation: 'Please send your location before sending via WhatsApp',
            locationNotShared: 'Location not shared'
        }
    };
    return labels[lang] || labels.ku;
}

function sendWhatsAppOrder() {
    if (cartItems.length === 0) return;
    
    var lang = localStorage.getItem('selectedLang') || 'ku';
    var cafeInfo = getCafeInfo();
    var cafeName = cafeInfo.name;
    var phone = normalizeWhatsAppPhone(cafeInfo.phone);
    
    var nameEl = document.getElementById('customerName');
    var placeEl = document.getElementById('customerPlace');
    var customerName = nameEl ? nameEl.value.trim() : '';
    var customerPlace = placeEl ? placeEl.value.trim() : '';

    var formT = getCartFormLabels(lang);
    var labels = {
        ku: { order: 'داواکاری نوێ', name: 'ناو', place: 'شوێن', total: 'کۆی گشتی', time: 'کات' },
        ar: { order: 'طلب جديد', name: 'الاسم', place: 'الموقع', total: 'الإجمالي', time: 'الوقت' },
        en: { order: 'New Order', name: 'Name', place: 'Location', total: 'Total', time: 'Time' }
    };
    var T = labels[lang] || labels.en;

    if (!customerName && !customerPlace) {
        showCartFormWarning(formT.needBoth, nameEl, [nameEl, placeEl]);
        return;
    }

    if (!customerName) {
        showCartFormWarning(formT.needName, nameEl, [nameEl]);
        return;
    }

    if (!customerPlace) {
        showCartFormWarning(formT.needPlace, placeEl, [placeEl]);
        return;
    }

    var sendOrder = function() {
        clearCartFormWarning();

        var divider = '------------------------';
        var LRM_TIME = '\u200E';
        var lines = [];
        lines.push(T.time + ': ' + LRM_TIME + new Date().toLocaleString());
        lines.push(cafeName + ' - ' + T.order);
        lines.push(T.name + ': ' + customerName);
        lines.push(T.place + ': ' + customerPlace);
        if (window._customerLocationUrl) {
            lines.push('Maps: ' + window._customerLocationUrl);
        } else {
            lines.push(formT.locationNotShared || 'Location not shared');
        }
        lines.push(divider);

        var LRM = '\u200E';
        cartItems.forEach(function (item) {
            lines.push(item.name);
            var lineTotal = (item.price * item.quantity).toLocaleString();
            if (item.quantity > 1) {
                lines.push(LRM + item.quantity + ' x ' + item.price.toLocaleString() + ' = ' + lineTotal + ' IQD');
            } else {
                lines.push(LRM + lineTotal + ' IQD');
            }
        });

        lines.push(divider);
        lines.push(T.total + ': ' + LRM + getCartTotal().toLocaleString() + ' IQD');

        var message = lines.join('\n');

        var encoded = encodeURIComponent(message);
        var url = 'https://wa.me/' + phone + '?text=' + encoded;
        var opened = window.open(url, '_blank', 'noopener,noreferrer');
        if (!opened) {
            window.location.href = url;
        }
    };

    if (window._customerLocationUrl) {
        sendOrder();
        return;
    }

    var statusEl = document.getElementById('cartLocationStatus');
    if (!navigator.geolocation) {
        if (statusEl) {
            statusEl.textContent = formT.locationNotShared || 'Location not shared';
            statusEl.className = 'cart-location-status error';
            statusEl.classList.remove('hidden');
            setTimeout(function() {
                statusEl.classList.add('hidden');
            }, 3000);
        }
        sendOrder();
        return;
    }

    navigator.geolocation.getCurrentPosition(
        function (pos) {
            var lat = pos.coords.latitude;
            var lng = pos.coords.longitude;
            window._customerLocationUrl = 'https://maps.google.com/?q=' + lat + ',' + lng;
            if (statusEl) {
                statusEl.textContent = 'Location captured ✓';
                statusEl.className = 'cart-location-status success';
                setTimeout(function() {
                    statusEl.classList.add('hidden');
                }, 2000);
            }
            sendOrder();
        },
        function (err) {
            window._customerLocationUrl = '';
            var msg = formT.locationNotShared || 'Location not shared';
            if (err && err.code === 1) msg = 'Location permission denied — you can continue without it';
            if (statusEl) {
                statusEl.textContent = msg;
                statusEl.className = 'cart-location-status error';
                statusEl.classList.remove('hidden');
                setTimeout(function() {
                    statusEl.classList.add('hidden');
                }, 3000);
            }
            sendOrder();
        },
        { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 }
    );
}

/* ========================================
   Cafe Info Panel
   ======================================== */

var CAFE_SETTING_KEYS = [
    'cafeName',
    'whatsappPhone',
    'cafeLocationUrl',
    'cafeLocationLabel',
    'cafeOpenTime',
    'cafeCloseTime',
    'cafeInstagram',
    'cafeTiktok',
    'cafeSnapchat'
];

function toLocaleDigits(value, lang) {
    var text = String(value);
    if (lang !== 'ku' && lang !== 'ar') return text;
    return text.replace(/\d/g, function (d) {
        return '٠١٢٣٤٥٦٧٨٩'[parseInt(d, 10)];
    });
}

function parseCafePeriodToPm(periodText) {
    var p = (periodText || '').trim().toLowerCase();
    if (!p) return null;
    if (/^p(?:m)?$/i.test(p) || p === 'م' || /مساء/.test(p) || /دوای\s*نیوەڕۆ|دواینیوەڕۆ/.test(p)) return true;
    if (/^a(?:m)?$/i.test(p) || p === 'ص' || /صباح/.test(p) || /بەیانی/.test(p)) return false;
    return null;
}

function normalizeCafeTimeValue(value, fallback) {
    fallback = fallback || '14:00';
    var raw = (value == null ? '' : String(value)).trim();
    if (!raw) return fallback;
    var normalizedRaw = raw
        .replace(/[٠-٩]/g, function (d) { return String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)); })
        .replace(/[۰-۹]/g, function (d) { return String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)); })
        .replace(/[\u200e\u200f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    var matchPeriod = normalizedRaw.match(/^(\d{1,2})(?::(\d{2}))?\s*(.+)$/);
    if (matchPeriod) {
        var hourPart = parseInt(matchPeriod[1], 10);
        var minutePart = parseInt(matchPeriod[2] || '0', 10);
        var isPm = parseCafePeriodToPm(matchPeriod[3]);
        if (isPm !== null && !isNaN(hourPart) && hourPart >= 1 && hourPart <= 12 && !isNaN(minutePart) && minutePart >= 0 && minutePart <= 59) {
            var hour24Period = hourPart % 12;
            if (isPm) hour24Period += 12;
            return String(hour24Period).padStart(2, '0') + ':' + String(minutePart).padStart(2, '0');
        }
    }

    var match12 = normalizedRaw.match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp](?:[Mm])?|[صم])$/);
    if (match12) {
        var hour12 = parseInt(match12[1], 10);
        var minute12 = parseInt(match12[2] || '0', 10);
        var marker = String(match12[3] || '').toLowerCase();
        var isPmMarker = marker.indexOf('p') === 0 || marker === 'م';
        if (!isNaN(hour12) && hour12 >= 1 && hour12 <= 12 && !isNaN(minute12) && minute12 >= 0 && minute12 <= 59) {
            var hour24 = hour12 % 12;
            if (isPmMarker) hour24 += 12;
            return String(hour24).padStart(2, '0') + ':' + String(minute12).padStart(2, '0');
        }
    }

    var match = normalizedRaw.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) {
        var hourOnly = parseInt(normalizedRaw, 10);
        if (!isNaN(hourOnly) && hourOnly >= 0 && hourOnly <= 23) {
            return String(hourOnly).padStart(2, '0') + ':00';
        }
        return fallback;
    }

    var hour = parseInt(match[1], 10);
    var minute = parseInt(match[2], 10);
    if (isNaN(hour) || hour < 0 || hour > 23 || isNaN(minute) || minute < 0 || minute > 59) {
        return fallback;
    }
    return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
}

function parseCafeTimeToMinutes(timeStr, fallbackHour) {
    var normalized = normalizeCafeTimeValue(timeStr, String(fallbackHour).padStart(2, '0') + ':00');
    var parts = normalized.split(':');
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

function formatCafeTimeForDisplay(timeStr, lang) {
    var normalized = normalizeCafeTimeValue(timeStr, '14:00');
    var parts = normalized.split(':');
    var hour24 = parseInt(parts[0], 10);
    var minute = parseInt(parts[1], 10);
    var strings = i18n[lang] || i18n.en;
    var hour12 = hour24 % 12 || 12;
    var minuteStr = String(minute).padStart(2, '0');
    var isPm = hour24 >= 12;

    if (lang === 'ku' || lang === 'ar') {
        var clock = toLocaleDigits(hour12, lang) + ':' + toLocaleDigits(minuteStr, lang);
        var period = isPm ? (strings.timePm || 'PM') : (strings.timeAm || 'AM');
        return clock + ' ' + period;
    }

    return hour12 + ':' + minuteStr + ' ' + (isPm ? 'PM' : 'AM');
}

function formatCafeHoursDisplay(info, lang) {
    var strings = i18n[lang] || i18n.en;
    var open = formatCafeTimeForDisplay(info.openTime || '14:00', lang);
    var close = formatCafeTimeForDisplay(info.closeTime || '02:00', lang);
    return (strings.cafeHoursDaily || 'Daily') + ': ' + open + ' — ' + close;
}

function parseCafeTimeParts(timeStr, fallback) {
    fallback = fallback || '14:00';
    var normalized = normalizeCafeTimeValue(timeStr, fallback);
    var pieces = normalized.split(':');
    var hour24 = parseInt(pieces[0], 10);
    var minute = parseInt(pieces[1], 10);
    return {
        normalized: normalized,
        hour12: hour24 % 12 || 12,
        minute: minute,
        isPm: hour24 >= 12
    };
}

function buildCafeTimeFromParts(hour12, minute, isPm) {
    var h = parseInt(hour12, 10);
    var m = parseInt(minute, 10);
    if (isNaN(h) || isNaN(m)) return '14:00';
    h = h % 12;
    if (isPm) h += 12;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function normalizeWhatsAppPhone(phone) {
    var digits = (phone || '').replace(/\D/g, '');
    if (!digits) return '9647506454656';
    if (digits.indexOf('00') === 0) digits = digits.slice(2);
    if (digits.indexOf('964') === 0) return digits;
    if (digits.indexOf('0') === 0) return '964' + digits.slice(1);
    if (digits.length === 10) return '964' + digits;
    return digits;
}

function normalizeSocialUrl(url, platform) {
    url = (url || '').trim();
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return url;
    if (url.indexOf('//') === 0) return 'https:' + url;

    var cleaned = url.replace(/^@+/, '').replace(/\s+/g, '');
    if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(cleaned)) {
        return 'https://' + cleaned.replace(/^https?:\/\//i, '');
    }

    if (platform === 'instagram') {
        return 'https://instagram.com/' + cleaned.replace(/^instagram\.com\/?/i, '');
    }
    if (platform === 'tiktok') {
        return 'https://www.tiktok.com/@' + cleaned.replace(/^@+/, '').replace(/^tiktok\.com\/?@?/i, '');
    }
    if (platform === 'snapchat') {
        return 'https://www.snapchat.com/add/' + cleaned.replace(/^@+/, '').replace(/^snapchat\.com\/add\/?/i, '');
    }

    return 'https://' + cleaned;
}

function applyCafeSettingsToLocalStorage(data) {
    if (!data || typeof data !== 'object') return;
    CAFE_SETTING_KEYS.forEach(function (key) {
        if (!Object.prototype.hasOwnProperty.call(data, key)) return;
        var val = data[key];
        if (val == null || String(val).trim() === '') {
            localStorage.removeItem(key);
        } else {
            localStorage.setItem(key, String(val).trim());
        }
    });
}

function getCafeSettingsFromLocalStorage() {
    var data = {};
    CAFE_SETTING_KEYS.forEach(function (key) {
        var value = localStorage.getItem(key);
        if (value != null && String(value).trim() !== '') {
            data[key] = String(value).trim();
        }
    });
    return data;
}

var cafeSettingsUnsubscribe = null;

function handleCafeSettingsStorageChange(event) {
    if (!event || !event.key) return;
    if (event.key === 'cafeSettingsUpdatedAt' || CAFE_SETTING_KEYS.indexOf(event.key) !== -1) {
        updateCafeInfoPanel();
    }
}

window.addEventListener('storage', handleCafeSettingsStorageChange);

function loadCafeSettingsFromFirestore(callback) {
    if (USE_LOCAL_API) {
        localApiRequest('settings.php?id=cafe').then(function(doc) {
            if (doc && doc.data) {
                var data = typeof doc.data === 'string' ? JSON.parse(doc.data) : doc.data;
                applyCafeSettingsToLocalStorage(data);
            }
            if (callback) callback();
        }).catch(function(err) {
            console.warn('Could not load cafe settings:', err.message);
            if (callback) callback();
        });
        return;
    }
    
    if (!window.db) {
        if (callback) callback();
        return;
    }

    window.db.collection('settings').doc('cafe').get().then(function (doc) {
        if (doc.exists) {
            applyCafeSettingsToLocalStorage(doc.data());
        }
        if (callback) callback();
    }).catch(function (err) {
        console.warn('Could not load cafe settings:', err.message);
        if (callback) callback();
    });
}

function subscribeCafeSettingsUpdates() {
    if (USE_LOCAL_API) {
        // For local API, we'll poll for changes every 5 seconds
        if (window._settingsPollInterval) {
            clearInterval(window._settingsPollInterval);
        }
        window._settingsPollInterval = setInterval(function() {
            if (!document.getElementById('menuGrid')) {
                clearInterval(window._settingsPollInterval);
                return;
            }
            localApiRequest('settings.php?id=cafe').then(function(doc) {
                if (doc && doc.data) {
                    var data = typeof doc.data === 'string' ? JSON.parse(doc.data) : doc.data;
                    applyCafeSettingsToLocalStorage(data);
                    updateCafeInfoPanel();
                }
            }).catch(function() {});
        }, 5000);
        return;
    }
    
    if (!window.db || !document.getElementById('menuGrid')) return;
    if (cafeSettingsUnsubscribe) {
        cafeSettingsUnsubscribe();
        cafeSettingsUnsubscribe = null;
    }

    cafeSettingsUnsubscribe = window.db.collection('settings').doc('cafe').onSnapshot(function (doc) {
        if (doc.exists) {
            applyCafeSettingsToLocalStorage(doc.data());
            updateCafeInfoPanel();
        }
    }, function (err) {
        console.warn('Cafe settings listener error:', err.message);
    });
}

function saveCafeSettingsToFirestore(data, callback) {
    if (USE_LOCAL_API) {
        localApiRequest('settings.php', {
            method: 'POST',
            body: { id: 'cafe', data: data }
        }).then(function() {
            if (callback) callback(null);
        }).catch(function(err) {
            if (callback) callback(err);
        });
        return;
    }
    
    if (!window.db) {
        if (callback) callback(new Error('Firestore not ready'));
        return;
    }

    var payload = Object.assign({}, data, {
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    var timedOut = false;
    var timer = setTimeout(function () {
        timedOut = true;
        if (callback) callback(new Error('Connection timeout'));
    }, 12000);

    window.db.collection('settings').doc('cafe').set(payload, { merge: true }).then(function () {
        clearTimeout(timer);
        if (!timedOut && callback) callback(null);
    }).catch(function (err) {
        clearTimeout(timer);
        if (!timedOut && callback) callback(err);
    });
}

window.loadCafeSettingsFromFirestore = loadCafeSettingsFromFirestore;
window.saveCafeSettingsToFirestore = saveCafeSettingsToFirestore;
window.subscribeCafeSettingsUpdates = subscribeCafeSettingsUpdates;
window.normalizeWhatsAppPhone = normalizeWhatsAppPhone;
window.normalizeSocialUrl = normalizeSocialUrl;
window.normalizeCafeTimeValue = normalizeCafeTimeValue;
window.formatCafeTimeForDisplay = formatCafeTimeForDisplay;
window.parseCafeTimeParts = parseCafeTimeParts;
window.buildCafeTimeFromParts = buildCafeTimeFromParts;
window.toLocaleDigits = toLocaleDigits;
window.applyCafeSettingsToLocalStorage = applyCafeSettingsToLocalStorage;

function getCafeInfo() {
    var defaultUrl = 'https://maps.app.goo.gl/mmi5iv7mnGKxKZoq9?g_st=ic';
    var defaultLabel = 'بەحرکە-مجەمع';
    var storedUrl = localStorage.getItem('cafeLocationUrl');
    var storedLabel = localStorage.getItem('cafeLocationLabel');

    if (storedUrl === 'https://maps.google.com/?q=Baharka+Erbil') {
        localStorage.setItem('cafeLocationUrl', defaultUrl);
        storedUrl = defaultUrl;
    }
    if (storedLabel === 'baharka-erbil | شارع 150') {
        localStorage.setItem('cafeLocationLabel', defaultLabel);
        storedLabel = defaultLabel;
    }

    var openTime = normalizeCafeTimeValue(localStorage.getItem('cafeOpenTime'), '14:00');
    var closeTime = normalizeCafeTimeValue(localStorage.getItem('cafeCloseTime'), '02:00');
    var openMinutes = parseCafeTimeToMinutes(openTime, 14);
    var closeMinutes = parseCafeTimeToMinutes(closeTime, 2);

    return {
        name: localStorage.getItem('cafeName') || 'Shawarma',
        phone: normalizeWhatsAppPhone(localStorage.getItem('whatsappPhone') || '9647506454656'),
        locationUrl: storedUrl || defaultUrl,
        locationLabel: storedLabel || defaultLabel,
        instagram: localStorage.getItem('cafeInstagram') || '',
        tiktok: localStorage.getItem('cafeTiktok') || '',
        snapchat: localStorage.getItem('cafeSnapchat') || '',
        openTime: openTime,
        closeTime: closeTime,
        openHour: Math.floor(openMinutes / 60),
        closeHour: Math.floor(closeMinutes / 60),
        openMinutes: openMinutes,
        closeMinutes: closeMinutes
    };
}

function isCafeOpen(info) {
    info = info || getCafeInfo();
    var now = new Date();
    var mins = now.getHours() * 60 + now.getMinutes();
    var start = info.openMinutes != null ? info.openMinutes : info.openHour * 60;
    var end = info.closeMinutes != null ? info.closeMinutes : info.closeHour * 60;
    if (start === end) return false;
    if (start < end) return mins >= start && mins < end;
    return mins >= start || mins < end;
}

function formatCafePhone(phone) {
    var digits = (phone || '').replace(/\D/g, '');
    if (!digits) return '';

    if (digits.indexOf('964') === 0 && digits.length >= 12) {
        var local = digits.slice(3);
        if (local.length === 10) {
            return '+964 ' + local.slice(0, 3) + ' ' + local.slice(3, 6) + ' ' + local.slice(6);
        }
        return '+964 ' + local.slice(0, 3) + ' ' + local.slice(3);
    }

    if (digits.length >= 10) {
        return '+' + digits;
    }

    return '+' + digits;
}

function updateCafeInfoPanel() {
    var overlay = document.getElementById('cafeInfoOverlay');
    if (!overlay) return;

    var lang = localStorage.getItem('selectedLang') || 'ku';
    var strings = i18n[lang] || i18n.en;
    var info = getCafeInfo();
    var open = isCafeOpen(info);

    var statusEl = document.getElementById('cafeStatusBadge');
    if (statusEl) {
        statusEl.classList.toggle('is-open', open);
        statusEl.classList.toggle('is-closed', !open);
        var statusText = statusEl.querySelector('[data-cafe-status-text]');
        if (statusText) statusText.textContent = open ? strings.cafeOpen : strings.cafeClosed;
    }

    var titleEl = document.getElementById('cafeInfoTitle');
    if (titleEl) titleEl.textContent = info.name || strings.cafeInfoTitle;

    var hoursEl = document.getElementById('cafeHoursText');
    if (hoursEl) hoursEl.textContent = formatCafeHoursDisplay(info, lang);

    var addressEl = document.getElementById('cafeAddressLink');
    var addressText = document.getElementById('cafeAddressText');
    if (addressEl) addressEl.href = info.locationUrl;
    if (addressText) addressText.textContent = info.locationLabel;

    var phoneEl = document.getElementById('cafePhoneDisplay');
    if (phoneEl) {
        phoneEl.textContent = formatCafePhone(info.phone);
        phoneEl.setAttribute('dir', 'ltr');
    }

    var instaBtn = document.getElementById('cafeInstagramBtn');
    var tiktokBtn = document.getElementById('cafeTiktokBtn');
    var snapBtn = document.getElementById('cafeSnapchatBtn');
    var socialBlock = document.querySelector('.cafe-info-block--social');

    var instagramUrl = normalizeSocialUrl(info.instagram, 'instagram');
    var tiktokUrl = normalizeSocialUrl(info.tiktok, 'tiktok');
    var snapchatUrl = normalizeSocialUrl(info.snapchat, 'snapchat');

    function wireSocialLink(btn, url) {
        if (!btn) return;
        if (url) {
            btn.href = url;
            btn.style.display = '';
            btn.removeAttribute('aria-hidden');
        } else {
            btn.href = '#';
            btn.style.display = 'none';
            btn.setAttribute('aria-hidden', 'true');
        }
    }

    wireSocialLink(instaBtn, instagramUrl);
    wireSocialLink(tiktokBtn, tiktokUrl);
    wireSocialLink(snapBtn, snapchatUrl);

    if (socialBlock) {
        socialBlock.style.display = (instagramUrl || tiktokUrl || snapchatUrl) ? '' : 'none';
    }
}

function openCafeInfoPanel() {
    loadCafeSettingsFromFirestore(function () {
        updateCafeInfoPanel();
        var overlay = document.getElementById('cafeInfoOverlay');
        if (overlay) {
            overlay.classList.add('open');
            overlay.setAttribute('aria-hidden', 'false');
            document.body.classList.add('cafe-info-open');
        }
    });
}

function closeCafeInfoPanel() {
    var overlay = document.getElementById('cafeInfoOverlay');
    if (overlay) {
        overlay.classList.remove('open');
        overlay.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('cafe-info-open');
    }
}

function shareCafeMenu() {
    var lang = localStorage.getItem('selectedLang') || 'ku';
    var strings = i18n[lang] || i18n.en;
    var info = getCafeInfo();
    var url = window.location.href.split('#')[0];
    var payload = {
        title: info.name,
        text: info.name + ' — Menu',
        url: url
    };

    if (navigator.share) {
        navigator.share(payload).catch(function () {});
        return;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () {
            alert(strings.linkCopied);
        });
        return;
    }

    prompt(strings.cafeShare, url);
}

function setupCafeInfoPanel() {
    var btn = document.getElementById('cafeInfoBtn');
    var overlay = document.getElementById('cafeInfoOverlay');
    if (!btn || !overlay) return;

    btn.addEventListener('click', openCafeInfoPanel);

    var closeBtn = document.getElementById('cafeInfoClose');
    if (closeBtn) closeBtn.addEventListener('click', closeCafeInfoPanel);

    overlay.addEventListener('click', function (e) {
        if (e.target === overlay || e.target.classList.contains('cafe-info-backdrop')) {
            closeCafeInfoPanel();
        }
    });

    var callBtn = document.getElementById('cafeCallBtn');
    if (callBtn) {
        callBtn.addEventListener('click', function () {
            var phone = normalizeWhatsAppPhone(getCafeInfo().phone);
            window.location.href = 'tel:+' + phone;
        });
    }

    var waBtn = document.getElementById('cafeWhatsappBtn');
    if (waBtn) {
        waBtn.addEventListener('click', function () {
            var phone = normalizeWhatsAppPhone(getCafeInfo().phone);
            window.open('https://wa.me/' + phone, '_blank');
        });
    }

    var shareBtn = document.getElementById('cafeShareBtn');
    if (shareBtn) shareBtn.addEventListener('click', shareCafeMenu);

    var locationBtn = document.getElementById('cafeLocationBtn');
    if (locationBtn) {
        locationBtn.addEventListener('click', function () {
            window.open(getCafeInfo().locationUrl, '_blank');
        });
    }

    var installHelpBtn = document.getElementById('cafeInstallHelpBtn');
    if (installHelpBtn && installHelpBtn.dataset.wired !== '1') {
        installHelpBtn.dataset.wired = '1';
        installHelpBtn.addEventListener('click', function () {
            closeCafeInfoPanel();
            openInstallTutorial();
        });
    }

    updateCafeInfoPanel();
    updateInstallHelpLabel();
}

function openCartPanel() {
    renderCartItems();
    updateCustomerFieldPlaceholders();
    clearCartFormWarning();
    var overlay = document.getElementById('cartOverlay');
    if (overlay) {
        overlay.classList.add('open');
        document.body.classList.add('cart-open');
    }
}

function updateCustomerFieldPlaceholders() {
    var lang = localStorage.getItem('selectedLang') || 'ku';
    var ph = {
        ku: { name: 'ناوی بەڕێزتان؟', place: 'شوێنی بەڕێزتان؟' },
        ar: { name: 'اسمك الكريم؟', place: 'موقعك؟' },
        en: { name: 'Your name?', place: 'Your location?' }
    };
    var p = ph[lang] || ph.en;
    var nameEl = document.getElementById('customerName');
    var placeEl = document.getElementById('customerPlace');
    if (nameEl) nameEl.placeholder = p.name;
    if (placeEl) placeEl.placeholder = p.place;
}

function closeCartPanel() {
    var overlay = document.getElementById('cartOverlay');
    if (overlay) {
        overlay.classList.remove('open');
        document.body.classList.remove('cart-open');
    }
}

function renderCartItems() {
    var container = document.getElementById('cartItems');
    var emptyEl = document.getElementById('cartEmpty');
    var totalEl = document.getElementById('cartTotal');
    var lang = localStorage.getItem('selectedLang') || 'ku';
    var S = i18n[lang] || i18n.en;

    if (!container) return;

    if (cartItems.length === 0) {
        container.innerHTML = '<div class="cart-empty">' +
            '<div class="cart-empty-icon">🛒</div>' +
            '<p>' + S.cartEmpty + '</p>' +
        '</div>';
        if (totalEl) totalEl.textContent = '0 IQD';
        return;
    }

    var total = 0;
    var html = '';
    cartItems.forEach(function(item) {
        var subtotal = item.price * item.quantity;
        total += subtotal;
        var fallbackImage = 'data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27100%27 height=%27100%27%3E%3Crect fill=%231a1a1a width=%27100%27 height=%27100%27/%3E%3Ctext x=%2750%25%27 y=%2750%25%27 font-size=%2724%27 text-anchor=%27middle%27 dy=%27.3em%27 fill=%23D4AF37%27%3E%E2%98%95%3C/text%3E%3C/svg%3E';
        var img = item.image || fallbackImage;

        html += '<div class="cart-item">' +
            '<div class="cart-item-img">' +
                '<img src="' + img + '" alt="' + item.name + '" onerror="this.onerror=null;this.src=\'' + fallbackImage + '\'">' +
            '</div>' +
            '<div class="cart-item-info">' +
                '<span class="cart-item-name">' + item.name + '</span>' +
                '<span class="cart-item-price">' + item.price.toLocaleString() + ' IQD</span>' +
            '</div>' +
            '<div class="cart-item-qty">' +
                '<button class="cart-qty-btn minus" data-id="' + item.id + '">−</button>' +
                '<span class="cart-qty-val">' + item.quantity + '</span>' +
                '<button class="cart-qty-btn plus" data-id="' + item.id + '">+</button>' +
            '</div>' +
            '<div class="cart-item-subtotal">' + subtotal.toLocaleString() + ' IQD</div>' +
            '<button class="cart-item-remove" data-id="' + item.id + '">✕</button>' +
        '</div>';
    });

    container.innerHTML = html;
    if (totalEl) totalEl.textContent = total.toLocaleString() + ' IQD';

    // Event listeners
    container.querySelectorAll('.cart-qty-btn.minus').forEach(function(btn) {
        btn.addEventListener('click', function() {
            updateCartQuantity(this.getAttribute('data-id'), -1);
            renderCartItems();
        });
    });

    container.querySelectorAll('.cart-qty-btn.plus').forEach(function(btn) {
        btn.addEventListener('click', function() {
            updateCartQuantity(this.getAttribute('data-id'), 1);
            renderCartItems();
        });
    });

    container.querySelectorAll('.cart-item-remove').forEach(function(btn) {
        btn.addEventListener('click', function() {
            removeFromCart(this.getAttribute('data-id'));
            renderCartItems();
        });
    });
}

/* ========================================
    Menu Features: Favorites & Ratings (DISABLED)
    ======================================== */

var MENU_FEATURES = {
    getFavorites() {
        try { return JSON.parse(localStorage.getItem('menu_favorites') || '[]'); } catch(e) { return []; }
    },
    toggleFav(id) {
        var favs = this.getFavorites();
        var idx = favs.indexOf(id);
        if (idx > -1) { favs.splice(idx, 1); } else { favs.push(id); }
        localStorage.setItem('menu_favorites', JSON.stringify(favs));
        return idx === -1;
    },
    isFav(id) { return this.getFavorites().indexOf(id) > -1; },
    getRating(itemId) {
        try { var r = JSON.parse(localStorage.getItem('menu_ratings') || '{}'); return r[itemId] || 0; } catch(e) { return 0; }
    },
    setRating(itemId, stars) {
        try { var r = JSON.parse(localStorage.getItem('menu_ratings') || '{}'); r[itemId] = stars; localStorage.setItem('menu_ratings', JSON.stringify(r)); } catch(e) {}
    }
};

function renderMenuCardsWithFeatures() {
    // Favorites and ratings are disabled - cart is now used instead
    // This function is kept for compatibility but does nothing
}

/* ========================================
    PWA Service Worker Registration
    ======================================== */

function checkForAppUpdate() {
    if (!navigator.onLine) return;
    fetch('./version.txt?_=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.text() : ''; })
        .then(function (text) {
            var remote = (text || '').trim();
            if (!remote) return;
            var key = 'aliCafeAppBuild';
            var seen = localStorage.getItem(key);
            if (seen && seen !== remote) {
                localStorage.setItem(key, remote);
                if (navigator.serviceWorker && navigator.serviceWorker.controller) {
                    navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
                }
                window.location.reload();
                return;
            }
            if (!seen) localStorage.setItem(key, remote);
        })
        .catch(function () {});
}

function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    var refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
    });

    navigator.serviceWorker.register('./sw.js').then(function (reg) {
        function activateWaiting(worker) {
            if (worker) worker.postMessage({ type: 'SKIP_WAITING' });
        }
        if (reg.waiting) activateWaiting(reg.waiting);
        reg.addEventListener('updatefound', function () {
            var worker = reg.installing;
            if (!worker) return;
            worker.addEventListener('statechange', function () {
                if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                    activateWaiting(worker);
                }
            });
        });

        function pokeServiceWorker() {
            reg.update().catch(function () {});
            checkForAppUpdate();
        }

        pokeServiceWorker();
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'visible') pokeServiceWorker();
        });
        window.addEventListener('focus', pokeServiceWorker);
        window.addEventListener('pageshow', function (event) {
            if (event.persisted) pokeServiceWorker();
        });
    }).catch(function (err) {
        console.warn('Service worker registration failed:', err);
    });
}

window.registerServiceWorker = registerServiceWorker;
window.checkForAppUpdate = checkForAppUpdate;

/* ========================================
   Add to Home Screen — image tutorial (menu only)
   Put PNG/JPG files in images/install/ (see README there)
   ======================================== */

var INSTALL_TUTORIAL_IMAGES = {
    ios: [
        'images/install/ios-step-1.png',
        'images/install/ios-step-2.png',
        'images/install/ios-step-3.png',
        'images/install/ios-step-4.png'
    ],
    android: [
        'images/install/android-step-1.png',
        'images/install/android-step-2.png',
        'images/install/android-step-3.png',
        'images/install/android-step-4.png'
    ]
};

function updateInstallHelpLabel() {
    var helpBtn = document.getElementById('cafeInstallHelpBtn');
    if (!helpBtn) return;
    var lang = localStorage.getItem('selectedLang') || 'ku';
    var S = i18n[lang] || i18n.en;
    var helpSpan = helpBtn.querySelector('[data-i18n-install]');
    if (helpSpan) helpSpan.textContent = S.installShowHelp;
}

function ensureInstallTutorialDOM() {
    if (document.getElementById('installTutorialOverlay')) return;

    var overlay = document.createElement('div');
    overlay.className = 'install-tutorial-overlay';
    overlay.id = 'installTutorialOverlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML =
        '<div class="install-tutorial-backdrop"></div>' +
        '<div class="install-tutorial-panel install-tutorial-panel--images" role="dialog" aria-labelledby="installTutorialTitle">' +
            '<button type="button" class="install-tutorial-close" id="installTutorialClose" aria-label="Close">✕</button>' +
            '<div class="install-tutorial-badge" aria-hidden="true">📲</div>' +
            '<h2 class="install-tutorial-title" id="installTutorialTitle"></h2>' +
            '<p class="install-tutorial-sub" id="installTutorialSub"></p>' +
            '<div class="install-platform-tabs" id="installPlatformTabs">' +
                '<button type="button" class="install-platform-tab active" data-platform="ios" id="installTabIos"></button>' +
                '<button type="button" class="install-platform-tab" data-platform="android" id="installTabAndroid"></button>' +
            '</div>' +
            '<div class="install-images-list" id="installStepsIos"></div>' +
            '<div class="install-images-list hidden" id="installStepsAndroid" hidden></div>' +
            '<p class="install-images-empty hidden" id="installImagesEmpty"></p>' +
            '<button type="button" class="install-tutorial-primary" id="installTutorialGotIt"></button>' +
        '</div>';
    document.body.appendChild(overlay);
    wireInstallTutorialOverlay(overlay);
}

function wireInstallTutorialOverlay(overlay) {
    if (!overlay || overlay.dataset.wired === '1') return;
    overlay.dataset.wired = '1';

    var closeBtn = document.getElementById('installTutorialClose');
    var gotIt = document.getElementById('installTutorialGotIt');
    if (closeBtn) closeBtn.addEventListener('click', closeInstallTutorial);
    if (gotIt) gotIt.addEventListener('click', closeInstallTutorial);

    overlay.addEventListener('click', function (e) {
        if (e.target === overlay || e.target.classList.contains('install-tutorial-backdrop')) {
            closeInstallTutorial();
        }
    });

    document.querySelectorAll('.install-platform-tab').forEach(function (tab) {
        tab.addEventListener('click', function () {
            setInstallPlatformTab(tab.getAttribute('data-platform'));
            updateInstallTutorialUI();
        });
    });
}

function setInstallPlatformTab(platform) {
    _installTutorialPlatform = platform;
    var iosSteps = document.getElementById('installStepsIos');
    var androidSteps = document.getElementById('installStepsAndroid');
    document.querySelectorAll('.install-platform-tab').forEach(function (tab) {
        tab.classList.toggle('active', tab.getAttribute('data-platform') === platform);
    });
    if (iosSteps) {
        iosSteps.classList.toggle('hidden', platform !== 'ios');
        iosSteps.hidden = platform !== 'ios';
    }
    if (androidSteps) {
        androidSteps.classList.toggle('hidden', platform !== 'android');
        androidSteps.hidden = platform !== 'android';
    }
}

var _installTutorialPlatform = '';

function getMobilePlatform() {
    var ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
        return 'ios';
    }
    if (/Android/i.test(ua)) return 'android';
    return 'ios';
}

function buildInstallImageHtml(stepNum, imageSrc) {
    return (
        '<div class="install-image-card">' +
            '<span class="install-image-num">' + stepNum + '</span>' +
            '<img src="' + imageSrc + '" alt="" loading="lazy" ' +
            'onerror="this.closest(\'.install-image-card\').classList.add(\'is-missing\')">' +
        '</div>'
    );
}

function renderInstallImagesList(container, images) {
    if (!container) return 0;
    var html = '';
    var count = 0;
    for (var i = 0; i < images.length; i++) {
        if (images[i]) {
            html += buildInstallImageHtml(i + 1, images[i]);
            count++;
        }
    }
    container.innerHTML = html;
    return count;
}

function updateInstallTutorialUI() {
    var lang = localStorage.getItem('selectedLang') || 'ku';
    var S = i18n[lang] || i18n.en;

    var title = document.getElementById('installTutorialTitle');
    var subtitle = document.getElementById('installTutorialSub');
    var tabIos = document.getElementById('installTabIos');
    var tabAndroid = document.getElementById('installTabAndroid');
    var gotIt = document.getElementById('installTutorialGotIt');
    var emptyMsg = document.getElementById('installImagesEmpty');

    if (title) title.textContent = S.installTitle;
    if (subtitle) subtitle.textContent = S.installSubtitle || '';
    if (tabIos) tabIos.textContent = S.installIos;
    if (tabAndroid) tabAndroid.textContent = S.installAndroid;
    if (gotIt) gotIt.textContent = S.installGotIt;

    var iosCount = renderInstallImagesList(document.getElementById('installStepsIos'), INSTALL_TUTORIAL_IMAGES.ios);
    var androidCount = renderInstallImagesList(document.getElementById('installStepsAndroid'), INSTALL_TUTORIAL_IMAGES.android);

    if (emptyMsg) {
        var platform = _installTutorialPlatform || getMobilePlatform();
        var visible = platform === 'ios' ? iosCount : androidCount;
        emptyMsg.textContent = S.installImagesMissing || 'Add tutorial images to images/install/';
        emptyMsg.classList.toggle('hidden', visible > 0);
    }

    updateInstallHelpLabel();
}

function openInstallTutorial() {
    ensureInstallTutorialDOM();
    updateInstallTutorialUI();
    setInstallPlatformTab(getMobilePlatform());

    var overlay = document.getElementById('installTutorialOverlay');
    if (overlay) {
        overlay.classList.add('open');
        overlay.setAttribute('aria-hidden', 'false');
        document.body.classList.add('install-tutorial-open');
    }
}

function closeInstallTutorial() {
    var overlay = document.getElementById('installTutorialOverlay');
    if (overlay) {
        overlay.classList.remove('open');
        overlay.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('install-tutorial-open');
    }
}

function setupInstallTutorial() {
    if (!document.getElementById('cafeInstallHelpBtn')) return;
    updateInstallHelpLabel();
}

window.openInstallTutorial = openInstallTutorial;

/* ========================================
   Utilities
   ======================================== */

function normalizeImageUrl(url) {
    if (!url) return null;
    try {
        new URL(url);
        return url;
    } catch (e) {
        return null;
    }
}

/* ========================================
   Logo navigation (single + double click)
   ======================================== */

window.replayLogoSplash = function (splashEl, durationMs) {
    if (!splashEl) splashEl = document.getElementById('logoSplash');
    if (!splashEl) return;

    var ms = durationMs || 1200;
    splashEl.style.display = 'flex';
    splashEl.classList.remove('hidden');
    clearTimeout(window.replayLogoSplash._hideTimer);
    window.replayLogoSplash._hideTimer = setTimeout(function () {
        splashEl.classList.add('hidden');
        setTimeout(function () { splashEl.style.display = 'none'; }, 500);
    }, ms);
};

window.setupLogoClickActions = function (logoEl, onSingleClick, doubleClickHref) {
    if (!logoEl) return;

    var clicks = 0;
    var timer = null;
    var doubleHref = doubleClickHref || 'login.html';

    logoEl.style.cursor = 'pointer';
    logoEl.addEventListener('click', function () {
        clicks++;
        if (clicks === 1) {
            timer = setTimeout(function () {
                clicks = 0;
                if (typeof onSingleClick === 'function') onSingleClick();
            }, 350);
        } else if (clicks === 2) {
            clearTimeout(timer);
            clicks = 0;
            window.location.href = doubleHref;
        }
    });
};


