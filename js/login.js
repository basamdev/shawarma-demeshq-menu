// Login.js - Handles admin authentication

document.addEventListener('DOMContentLoaded', function() {
    const loginForm = document.getElementById('loginForm');
    const loginError = document.getElementById('loginError');
    const showCreateAccountBtn = document.getElementById('showCreateAccountBtn');
    const createAccountBox = document.getElementById('createAccountBox');
    const createAccountBtn = document.getElementById('createAccountBtn');
    const createAccountError = document.getElementById('createAccountError');

    function showMessage(element, message, isError) {
        if (!element) return;
        element.textContent = message || '';
        element.style.display = message ? 'block' : 'none';
        if (element === loginError || element === createAccountError) {
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

    if (showCreateAccountBtn && createAccountBox) {
        showCreateAccountBtn.addEventListener('click', function() {
            createAccountBox.style.display = createAccountBox.style.display === 'block' ? 'none' : 'block';
            showMessage(createAccountError, '', false);
            showMessage(loginError, '', false);
        });
    }

    if (createAccountBtn) {
        createAccountBtn.addEventListener('click', function() {
            const email = document.getElementById('createEmail').value.trim();
            const password = document.getElementById('createPassword').value;
            const confirmPassword = document.getElementById('confirmPassword').value;

            if (!email || !password || !confirmPassword) {
                showMessage(createAccountError, 'Please fill in all fields', true);
                return;
            }

            if (password.length < 6) {
                showMessage(createAccountError, 'Password should be at least 6 characters', true);
                return;
            }

            if (password !== confirmPassword) {
                showMessage(createAccountError, 'Passwords do not match', true);
                return;
            }

            auth.createUserWithEmailAndPassword(email, password)
                .then(function() {
                    showMessage(createAccountError, 'Admin account created. Redirecting...', false);
                    window.location.href = 'admin.html';
                })
                .catch(function(error) {
                    let errorMessage = 'Could not create account';
                    if (error.code === 'auth/email-already-in-use') {
                        errorMessage = 'This email is already registered';
                    } else if (error.code === 'auth/weak-password') {
                        errorMessage = 'Password should be at least 6 characters';
                    } else if (error.code === 'auth/operation-not-allowed') {
                        errorMessage = 'Enable Email/Password sign-in in Firebase Authentication';
                    } else if (error.code === 'auth/network-request-failed') {
                        errorMessage = 'Network error. Please try again';
                    }
                    showMessage(createAccountError, errorMessage, true);
                });
        });
    }

    auth.onAuthStateChanged(function(user) {
        if (user) {
            window.location.href = 'admin.html';
        }
    });
});