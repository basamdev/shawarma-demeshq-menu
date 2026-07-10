// Sample Data for Shawarma
// Run this in browser console after opening the Firebase console or create a simple HTML file to add sample items

const sampleItems = [
    {
        name_ku: "لاتە",
        name_ar: "لاتيه",
        name_en: "Latte",
        description_ku: "قاوەی لاتەی گەرم",
        description_ar: "مشروب لاتيه ساخن",
        description_en: "Hot latte coffee with steamed milk",
        price: 2500,
        image: "https://images.unsplash.com/photo-1561882468-9110e03e0f78?w=400",
        category: "Coffee",
        available: true
    },
    {
        name_ku: "ئێسپرێسۆ",
        name_ar: "إسبريسو",
        name_en: "Espresso",
        description_ku: "قاوەی ئێسپرێسۆی بەهێز",
        description_ar: "قهوة إسبريسو قوية",
        description_en: "Strong black coffee shot",
        price: 2000,
        image: "https://images.unsplash.com/photo-1510591509098-f4fdc6d0ff04?w=400",
        category: "Coffee",
        available: true
    },
    {
        name_ku: "کاپوچینۆ",
        name_ar: "كابوتشينو",
        name_en: "Cappuccino",
        description_ku: "قاوەی کاپوچینۆ پێکهێنراو لە فوم و شیر",
        description_ar: "قهوة كابوتشينو مع الرغوة",
        description_en: "Coffee with steamed milk foam",
        price: 3000,
        image: "https://images.unsplash.com/photo-1572442388796-11668a67e53d?w=400",
        category: "Coffee",
        available: true
    },
    {
        name_ku: "ئامریکەنۆ",
        name_ar: "أمريكانو",
        name_en: "Americano",
        description_ku: "قاوەی ئامریکەنۆ",
        description_ar: "قهوة أمريكانو",
        description_en: "Black coffee with hot water",
        price: 2200,
        image: "https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=400",
        category: "Coffee",
        available: true
    },
    {
        name_ku: "چای",
        name_ar: "شاي",
        name_en: "Tea",
        description_ku: "چای گەرم",
        description_ar: "شاي ساخن",
        description_en: "Hot black tea",
        price: 1500,
        image: "https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=400",
        category: "Tea",
        available: true
    },
    {
        name_ku: "چای زیرە",
        name_ar: "شاي أعشاب",
        name_en: "Herbal Tea",
        description_ku: "چای زیرەو گژن",
        description_ar: "شاي بالأعشاب",
        description_en: "Herbal infusion tea",
        price: 1800,
        image: "https://images.unsplash.com/photo-1594631252845-29fc4cc8cde9?w=400",
        category: "Tea",
        available: true
    },
    {
        name_ku: "موکیاتا",
        name_ar: "موكاتا",
        name_en: "Mocha",
        description_ku: "قاوەی موکیاتا پێکهێنراو لە شکۆلات",
        description_ar: "قهوة موكاتا بالشوكولاتة",
        description_en: "Coffee with chocolate and steamed milk",
        price: 3500,
        image: "https://images.unsplash.com/photo-1578314675249-a6910f80cc4e?w=400",
        category: "Coffee",
        available: true
    },
    {
        name_ku: "کۆکا",
        name_ar: "كوكا كولا",
        name_en: "Coca-Cola",
        description_ku: "شار蝙蝠ەوەری گازدار",
        description_ar: "مشروب غازي",
        description_en: "Carbonated soft drink",
        price: 1500,
        image: "https://images.unsplash.com/photo-1554866585-cd94860890b7?w=400",
        category: "Cold Drinks",
        available: true
    },
    {
        name_ku: "ئاژنە",
        name_ar: "عصير برتقال",
        name_en: "Orange Juice",
        description_ku: "ئاژنەی تازە",
        description_ar: "عصير برتقال طازج",
        description_en: "Fresh orange juice",
        price: 2500,
        image: "https://images.unsplash.com/photo-1613478223719-2ab802602423?w=400",
        category: "Cold Drinks",
        available: true
    },
    {
        name_ku: "کەیک شکۆلات",
        name_ar: "كيك شوكولاتة",
        name_en: "Chocolate Cake",
        description_ku: "کەیکی شکۆلات بەتام",
        description_ar: "كيك شوكولاتة لذيذ",
        description_en: "Delicious chocolate cake",
        price: 4000,
        image: "https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400",
        category: "Dessert",
        available: true
    },
    {
        name_ku: "تیرەمێ سوو",
        name_ar: "زبادي",
        name_en: "Cheesecake",
        description_ku: "تیرەمێ سوو",
        description_ar: "تشيز كيك",
        description_en: "Creamy cheesecake",
        price: 4500,
        image: "https://images.unsplash.com/photo-1567327613485-fbc7bf196198?w=400",
        category: "Dessert",
        available: true
    },
    {
        name_ku: "نێرگیلە",
        name_ar: "نرگیلة",
        name_en: "Shisha",
        description_ku: "نێرگیلەی بە تەمی میوە",
        description_ar: "نرگیلة بنكهة الفواكه",
        description_en: "Fruit-flavored shisha",
        price: 5000,
        image: "https://cdn-icons-png.flaticon.com/128/10170/10170651.png",
        category: "Shisha",
        available: true
    },
    {
        name_ku: "فریزێ",
        name_ar: "فرابيه",
        name_en: "Frappe",
        description_ku: "قاوەی فریزێ سارد",
        description_ar: "قهوة فرابيه باردة",
        description_en: "Iced blended coffee",
        price: 3500,
        image: "https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=400",
        category: "Special Drinks",
        available: true
    },
    {
        name_ku: "میلک شێیک",
        name_ar: "ميلك شيك",
        name_en: "Milkshake",
        description_ku: "مilk شێیکی شیرین",
        description_ar: "ميلك شيك",
        description_en: "Sweet vanilla milkshake",
        price: 3000,
        image: "https://images.unsplash.com/photo-1572490122747-3968b75cc699?w=400",
        category: "Special Drinks",
        available: true
    }
];

console.log("Sample items loaded:", sampleItems.length);
console.log("Copy this data to your Firebase console or use the admin panel to add items.");