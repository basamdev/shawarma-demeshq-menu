// Login.js - Handles admin authentication

document.addEventListener('DOMContentLoaded', function() {
    const loginForm = document.getElementById('loginForm');
    const loginError = document.getElementById('loginError');

    function showMessage(element, message, isError) {
        if (!element) return;
        element.textContent = message || '';
        element.style.display = message ? 'block' : 'none';
        if (element === loginError) {
            element.style.color = isError ? '#ff5c5c' : '#2e7d32';
        }
    }

    if (loginForm) {
        loginForm.addEventListener('submit', function(e) {
            e.preventDefault();

            const email = document.getElementById('email').value.trim();
            const password = document.getElementById('password').value;

            if (!email || !password) {
                showMessage(loginError, 'Please fill in all fields', true);
                return;
            }

            if (typeof USE_LOCAL_API !== 'undefined' && USE_LOCAL_API) {
                // Use authApi.login() which resolves the API URL absolutely
                // (via getApiUrl) and sends credentials. Building the URL
                // relatively with localApiRequest('auth.php') only works when
                // login.html shares the exact origin/path as the PHP backend;
                // otherwise the POST never reaches api/auth.php and login fails.
                authApi.login(email, password).then(function(response) {
                    if (response.token) {
                        window.currentAuthToken = response.token;
                        window.currentUser = response.user;
                        localStorage.setItem('adminAuthToken', response.token);
                        localStorage.setItem('adminUser', JSON.stringify(response.user));
                    }
                    showMessage(loginError, '', false);
                    window.location.href = 'admin.html';
                }).catch(function(error) {
                    showMessage(loginError, error.message || 'Authentication failed', true);
                });
                return;
            }

            auth.signInWithEmailAndPassword(email, password)
                .then(function() {
                    showMessage(loginError, '', false);
                    window.location.href = 'admin.html';
                })
                .catch(function(error) {
                    const errorCode = error.code;
                    let errorMessage = 'Authentication failed';

                    if (errorCode === 'auth/user-not-found') {
                        errorMessage = 'No user found with this email';
                    } else if (errorCode === 'auth/wrong-password') {
                        errorMessage = 'Invalid password';
                    } else if (errorCode === 'auth/invalid-email') {
                        errorMessage = 'Please enter a valid email';
                    } else if (errorCode === 'auth/network-request-failed') {
                        errorMessage = 'Network error. Please try again';
                    } else if (errorCode === 'auth/operation-not-allowed') {
                        errorMessage = 'Enable Email/Password sign-in in Firebase Authentication';
                    }

                    showMessage(loginError, errorMessage, true);
                });
        });
    }

    if (typeof USE_LOCAL_API === 'undefined' || !USE_LOCAL_API) {
        auth.onAuthStateChanged(function(user) {
            if (user) {
                window.location.href = 'admin.html';
            }
        });
    }
});
