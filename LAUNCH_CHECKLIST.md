# Ali Coffee Menu — Launch Checklist (v87)

Use this before printing QR codes and selling to customers.

**Live site:** https://shawarma-demeshq-menu.vercel.app  
**Customer menu:** https://shawarma-demeshq-menu.vercel.app/menu.html  
**Admin:** https://shawarma-demeshq-menu.vercel.app/admin.html  

---

## QR code — do you need to reprint?

| Change | Reprint QR? |
|--------|-------------|
| Add / edit / delete item | **No** |
| Change price | **No** |
| Add / edit / delete category | **No** |
| Change menu text (KU / AR / EN) | **No** |
| Change website URL or domain | **Yes** |

The QR is only a link. Customers always get the **latest menu from the cloud** when they open the link **with internet**.

---

## Before you print (one-time)

- [ ] Open admin → **Manage Items** shows **v87**
- [ ] Logged in to admin (not expired session)
- [ ] All real items and categories added (not test data)
- [ ] Prices correct in all 3 languages
- [ ] WhatsApp / location in Settings correct
- [ ] Test QR opens menu on your phone (Safari scan)

**Print QR pointing to:**  
`https://shawarma-demeshq-menu.vercel.app/menu.html`  
(or `index.html` if you want language selection first)

---

## Critical test (do on 2 phones)

### 1. Add item (admin phone, **Wi‑Fi on**)

1. Admin → Manage Items → Add item  
2. Save → message should say menu updated for all customers (cloud sync)  
3. On **second phone**, open menu link in Safari (not admin)  
4. New item appears within ~30 seconds (close and reopen menu if needed)

### 2. Edit price

1. Change price in admin → save  
2. Customer menu shows new price (refresh menu or reopen app)

### 3. Category

1. Add or edit category in admin  
2. Category appears on customer menu

### 4. Delete item

1. Delete test item in admin  
2. Item gone from customer menu

### 5. QR code

1. Scan printed QR (or photo of QR)  
2. Same menu as opening link in browser

### 6. Home screen app (optional)

1. Add menu to home screen once  
2. After admin edit (online), open home screen app  
3. Menu should refresh (may take a few seconds)

### 7. Cashier + dashboard

1. One test sale in Cashier  
2. Dashboard shows sale today

### 8. Reset data (Settings)

1. Reset all data → confirm  
2. Sales/expenses cleared  
3. **Menu items and categories still there**

---

## If something fails

| Problem | What to do |
|---------|------------|
| "Could not sync to cloud" on save | Turn on Wi‑Fi, log in again, retry save |
| Customer menu old | Customer opens menu **online** once; pull down / reopen |
| Admin shows item, menu does not | Save failed — check sync message, retry online |
| Infinite loading | Hard refresh; check internet; confirm v87 in admin |

---

## Selling to other cafés

Tell them:

1. **One QR** on printed menu — never reprint for price changes  
2. You edit items on **phone admin** when online  
3. Customers scan QR → always latest menu  
4. Optional: Add to Home Screen for staff (admin)

---

## Version

Current launch version: **v87**  
Check: Admin → Manage Items (small text next to title)
