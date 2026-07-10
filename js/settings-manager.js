// Settings Manager for direct editing in menu.html
class SettingsManager {
    constructor() {
        this.settings = {
            whatsappPhone: localStorage.getItem('whatsappPhone') || '9647506454656',
            cafeLocationLabel: localStorage.getItem('cafeLocationLabel') || 'بەحرکە-مجەمع',
            cafeLocationUrl: localStorage.getItem('cafeLocationUrl') || 'https://maps.app.goo.gl/mmi5iv7mnGKxKZoq9?g_st=ic',
            cafeName: localStorage.getItem('cafeName') || 'Shawarma',
            cafeOpenTime: localStorage.getItem('cafeOpenTime') || '14:00',
            cafeCloseTime: localStorage.getItem('cafeCloseTime') || '02:00'
        };
        
        // Load Firestore if available
        if (window.db && window.auth) {
            this.loadFromFirestore();
        }
        
        this.applySettings();
    }
    
    loadFromFirestore() {
        if (!window.auth.currentUser) return;
        
        window.db.collection('settings').doc('cafe').get()
            .then(doc => {
                if (doc.exists) {
                    const data = doc.data();
                    Object.assign(this.settings, {
                        whatsappPhone: data.whatsappPhone || this.settings.whatsappPhone,
                        cafeLocationLabel: data.cafeLocationLabel || this.settings.cafeLocationLabel,
                        cafeLocationUrl: data.cafeLocationUrl || this.settings.cafeLocationUrl,
                        cafeName: data.cafeName || this.settings.cafeName,
                        cafeOpenTime: data.cafeOpenTime || this.settings.cafeOpenTime,
                        cafeCloseTime: data.cafeCloseTime || this.settings.cafeCloseTime
                    });
                    
                    // Save to localStorage
                    this.saveToLocalStorage();
                    this.applySettings();
                }
            })
            .catch(err => {
                console.warn('Could not load settings from Firestore:', err);
            });
    }
    
    saveToLocalStorage() {
        Object.keys(this.settings).forEach(key => {
            localStorage.setItem(key, this.settings[key]);
        });
    }
    
    saveToFirestore() {
        if (!window.db || !window.auth.currentUser) {
            console.warn('Firestore not available or not authenticated');
            return;
        }
        
        window.db.collection('settings').doc('cafe').set(this.settings, { merge: true })
            .then(() => {
                console.log('Settings saved to Firestore');
                // Show toast notification
                this.showToast('Settings saved to cloud!');
            })
            .catch(err => {
                console.error('Error saving to Firestore:', err);
                this.showToast('Failed to save to cloud: ' + err.message);
            });
    }
    
    applySettings() {
        // Update phone display
        const phoneDisplay = document.getElementById('cafePhoneDisplay');
        if (phoneDisplay) {
            phoneDisplay.textContent = this.settings.whatsappPhone;
            // Format for click-to-call
            const cleanPhone = this.settings.whatsappPhone.replace(/\D/g, '');
            phoneDisplay.parentElement.href = `tel:+${cleanPhone}`;
        }
        
        // Update location display
        const locationText = document.getElementById('cafeAddressText');
        const locationLink = document.getElementById('cafeAddressLink');
        if (locationText) locationText.textContent = this.settings.cafeLocationLabel;
        if (locationLink) locationLink.href = this.settings.cafeLocationUrl;
        
        // Update cafe name in header
        const cafeTitle = document.querySelector('.cafe-info-title');
        if (cafeTitle) cafeTitle.textContent = this.settings.cafeName;
        
        // Update cafe name in hero section
        const heroTitle = document.getElementById('heroTitleTyped');
        if (heroTitle) heroTitle.textContent = this.settings.cafeName;
        
        // Update hours display
        const hoursText = document.getElementById('cafeHoursText');
        if (hoursText) {
            hoursText.textContent = `رۆژانە: ${this.settings.cafeOpenTime} بەیانی — ${this.settings.cafeCloseTime} دوای نیوەڕۆ`;
        }
        
        // Update WhatsApp button
        const whatsappBtn = document.getElementById('cafeWhatsappBtn');
        const cartWhatsappBtn = document.getElementById('cartWhatsapp');
        if (whatsappBtn) {
            const cleanPhone = this.settings.whatsappPhone.replace(/\D/g, '');
            whatsappBtn.href = `https://wa.me/${cleanPhone}`;
        }
        if (cartWhatsappBtn) {
            const cleanPhone = this.settings.whatsappPhone.replace(/\D/g, '');
            cartWhatsappBtn.querySelector('svg').parentElement.href = `https://wa.me/${cleanPhone}`;
        }
        
        // Update social media links
        const instagramBtn = document.getElementById('cafeInstagramBtn');
        const tiktokBtn = document.getElementById('cafeTiktokBtn');
        const snapchatBtn = document.getElementById('cafeSnapchatBtn');
        
        if (instagramBtn && this.settings.cafeInstagram) {
            instagramBtn.href = this.settings.cafeInstagram;
        }
        if (tiktokBtn && this.settings.cafeTiktok) {
            tiktokBtn.href = this.settings.cafeTiktok;
        }
        if (snapchatBtn && this.settings.cafeSnapchat) {
            snapchatBtn.href = this.settings.cafeSnapchat;
        }
    }
    
    showToast(message) {
        // Remove existing toast
        const existingToast = document.querySelector('.settings-toast');
        if (existingToast) existingToast.remove();
        
        const toast = document.createElement('div');
        toast.className = 'settings-toast';
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #32CD32;
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 1000;
            font-size: 14px;
            animation: slideIn 0.3s ease-out;
        `;
        
        document.body.appendChild(toast);
        
        // Add animation
        setTimeout(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        }, 10);
        
        // Remove after 3 seconds
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(20px)';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
    
    openSettingsModal() {
        // Create modal if doesn't exist
        if (!document.getElementById('settingsModal')) {
            this.createSettingsModal();
        }
        
        // Populate form with current values
        document.getElementById('settingCafeName').value = this.settings.cafeName;
        document.getElementById('settingWhatsappPhone').value = this.settings.whatsappPhone;
        document.getElementById('settingLocationLabel').value = this.settings.cafeLocationLabel;
        document.getElementById('settingLocationUrl').value = this.settings.cafeLocationUrl;
        document.getElementById('settingOpenTime').value = this.settings.cafeOpenTime;
        document.getElementById('settingCloseTime').value = this.settings.cafeCloseTime;
        
        // Show modal
        document.getElementById('settingsModal').style.display = 'flex';
    }
    
    createSettingsModal() {
        const modal = document.createElement('div');
        modal.id = 'settingsModal';
        modal.style.cssText = `
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            backdrop-filter: blur(5px);
            z-index: 2000;
            justify-content: center;
            align-items: center;
        `;
        
        modal.innerHTML = `
            <div style="
                background: white;
                border-radius: 12px;
                width: 90%;
                max-width: 500px;
                max-height: 90vh;
                overflow-y: auto;
                padding: 24px;
                box-shadow: 0 8px 32px rgba(0,0,0,0.25);
            ">
                <h2 style="margin-top: 0; color: #333;">Cafe Settings</h2>
                
                <div style="margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 8px; font-weight: bold;">Cafe Name</label>
                    <input type="text" id="settingCafeName" style="width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 16px;">
                </div>
                
                <div style="margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 8px; font-weight: bold;">WhatsApp Phone</label>
                    <input type="tel" id="settingWhatsappPhone" style="width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 16px;" placeholder="9647506454656">
                </div>
                
                <div style="margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 8px; font-weight: bold;">Location Label</label>
                    <input type="text" id="settingLocationLabel" style="width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 16px;">
                </div>
                
                <div style="margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 8px; font-weight: bold;">Location URL (Google Maps)</label>
                    <input type="url" id="settingLocationUrl" style="width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 16px;" placeholder="https://maps.google.com/...">
                </div>
                
                <div style="margin-bottom: 20px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    <div>
                        <label style="display: block; margin-bottom: 8px; font-weight: bold;">Open Time</label>
                        <input type="time" id="settingOpenTime" style="width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 6px;">
                    </div>
                    <div>
                        <label style="display: block; margin-bottom: 8px; font-weight: bold;">Close Time</label>
                        <input type="time" id="settingCloseTime" style="width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 6px;">
                    </div>
                </div>
                
                <div style="margin-top: 24px; display: flex; gap: 12px;">
                    <button id="cancelSettingsBtn" style="
                        flex: 1;
                        padding: 12px 24px;
                        background: #f5f5f5;
                        border: none;
                        border-radius: 6px;
                        cursor: pointer;
                        font-weight: 600;
                        transition: background 0.2s;
                    ">Cancel</button>
                    <button id="saveSettingsBtn" style="
                        flex: 1;
                        padding: 12px 24px;
                        background: #4CAF50;
                        color: white;
                        border: none;
                        border-radius: 6px;
                        cursor: pointer;
                        font-weight: 600;
                        transition: background 0.2s;
                    ">Save Settings</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Event listeners
        document.getElementById('cancelSettingsBtn').addEventListener('click', () => {
            modal.style.display = 'none';
        });
        
        document.getElementById('saveSettingsBtn').addEventListener('click', () => {
            this.settings.cafeName = document.getElementById('settingCafeName').value.trim() || this.settings.cafeName;
            this.settings.whatsappPhone = document.getElementById('settingWhatsappPhone').value.trim() || this.settings.whatsappPhone;
            this.settings.cafeLocationLabel = document.getElementById('settingLocationLabel').value.trim() || this.settings.cafeLocationLabel;
            this.settings.cafeLocationUrl = document.getElementById('settingLocationUrl').value.trim() || this.settings.cafeLocationUrl;
            this.settings.cafeOpenTime = document.getElementById('settingOpenTime').value || this.settings.cafeOpenTime;
            this.settings.cafeCloseTime = document.getElementById('settingCloseTime').value || this.settings.cafeCloseTime;
            
            this.saveToLocalStorage();
            this.saveToFirestore();
            this.applySettings();
            
            modal.style.display = 'none';
            this.showToast('Settings saved successfully!');
        });
        
        // Close on outside click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });
        
        // Add some basic styles
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideIn {
                from { opacity: 0; transform: translateY(20px); }
                to { opacity: 1; transform: translateY(0); }
            }
        `;
        document.head.appendChild(style);
    }
    
    init() {
        // Add settings button to cafe info section
        const cafeInfoSection = document.querySelector('.cafe-info-block');
        if (cafeInfoSection) {
            const settingsBtn = document.createElement('button');
            settingsBtn.innerHTML = '<i class="fa-solid fa-gear"></i> Settings';
            settingsBtn.style.cssText = `
                display: block;
                width: 100%;
                padding: 12px;
                margin-top: 16px;
                background: #f0f0f0;
                border: none;
                border-radius: 6px;
                cursor: pointer;
                font-weight: 600;
                color: #333;
                transition: background 0.2s;
            `;
            settingsBtn.addEventListener('click', () => this.openSettingsModal());
            
            // Insert after the hours section
            const hoursSection = document.querySelector('.cafe-info-block:has(#cafeHoursText)');
            if (hoursSection) {
                hoursSection.insertAdjacentElement('afterend', settingsBtn);
            } else {
                cafeInfoSection.appendChild(settingsBtn);
            }
        }
        
        // Also add to header for easy access
        const header = document.querySelector('.menu-hero-brand');
        if (header) {
            const headerSettings = document.createElement('button');
            headerSettings.innerHTML = '<i class="fa-solid fa-gear"></i>';
            headerSettings.title = 'Settings';
            headerSettings.style.cssText = `
                position: absolute;
                top: 12px;
                right: 12px;
                background: rgba(255,255,255,0.2);
                border: none;
                border-radius: 50%;
                width: 36px;
                height: 36px;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                backdrop-filter: blur(4px);
                transition: background 0.2s;
            `;
            headerSettings.addEventListener('click', () => this.openSettingsModal());
            header.style.position = 'relative';
            header.appendChild(headerSettings);
        }
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.settingsManager = new SettingsManager();
    window.settingsManager.init();
});