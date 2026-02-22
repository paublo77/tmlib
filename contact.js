/ ==UserScript==
// @name         Google Contacts Phone Lookup
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Check if a phone number exists in your Google Contacts using People API
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// ==/UserScript==

(function () {
    "use strict";

    // ===== CONFIG =====
    const CLIENT_ID = "329205197327-vvbujn7nh03m1b42r8ov4et9nckg8f7k.apps.googleusercontent.com";
    const REDIRECT_URI = "https://paublo77.github.io/tmlib/redirect.html";
    const SCOPES = "https://www.googleapis.com/auth/contacts.readonly";

    const TOKEN_KEY = "google_contacts_access_token";
    const TOKEN_EXP_KEY = "google_contacts_access_token_expires_at";

    // ===== TOKEN MANAGEMENT =====

    function getStoredToken() {
        const token = GM_getValue(TOKEN_KEY, null);
        const exp = GM_getValue(TOKEN_EXP_KEY, 0);
        if (!token) return null;
        if (Date.now() > exp) {
            // expired
            return null;
        }
        return token;
    }

    function storeToken(accessToken, expiresInSeconds) {
        const expiresAt = Date.now() + (expiresInSeconds * 1000) - 30 * 1000; // 30s safety margin
        GM_setValue(TOKEN_KEY, accessToken);
        GM_setValue(TOKEN_EXP_KEY, expiresAt);
    }

    function clearToken() {
        GM_deleteValue(TOKEN_KEY);
        GM_deleteValue(TOKEN_EXP_KEY);
    }

    // ===== OAUTH FLOW =====

    function buildAuthUrl() {
        const params = new URLSearchParams();
        params.set("client_id", CLIENT_ID);
        params.set("redirect_uri", REDIRECT_URI);
        params.set("response_type", "token");
        params.set("scope", SCOPES);
        params.set("include_granted_scopes", "true");
        params.set("prompt", "consent"); // or "select_account" if you prefer

        return "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString();
    }

    function startOAuthFlow() {
        return new Promise((resolve, reject) => {
            const authUrl = buildAuthUrl();
            const popup = window.open(authUrl, "google_oauth", "width=500,height=600");

            if (!popup) {
                reject(new Error("Popup blocked"));
                return;
            }

            function onMessage(event) {
                const data = event.data;
                if (!data || data.type !== "google_oauth_token") return;

                window.removeEventListener("message", onMessage);

                if (data.access_token) {
                    storeToken(data.access_token, data.expires_in || 3600);
                    resolve(data.access_token);
                } else {
                    reject(new Error("No access token received"));
                }
            }

            window.addEventListener("message", onMessage);

            // Optional timeout
            setTimeout(() => {
                window.removeEventListener("message", onMessage);
                reject(new Error("OAuth timeout"));
            }, 2 * 60 * 1000);
        });
    }

    async function getAccessToken() {
        const existing = getStoredToken();
        if (existing) return existing;

        // No valid token, start OAuth
        return await startOAuthFlow();
    }

    // ===== PEOPLE API: SEARCH BY PHONE =====

    async function findContactByPhone(phoneNumber, accessToken) {
        const url = "https://people.googleapis.com/v1/people:searchContacts"
            + "?query=" + encodeURIComponent(phoneNumber)
            + "&readMask=names,phoneNumbers";

        const res = await fetch(url, {
            headers: {
                "Authorization": "Bearer " + accessToken
            }
        });

        if (res.status === 401) {
            // token invalid/expired
            clearToken();
            throw new Error("Unauthorized, token invalid");
        }

        if (!res.ok) {
            const text = await res.text();
            throw new Error("People API error: " + res.status + " " + text);
        }

        const data = await res.json();
        return data.results || [];
    }

    // ===== SIMPLE CACHE (PER SESSION) =====

    const phoneCache = new Map(); // phone -> result array

    async function lookupPhone(phoneNumber) {
        if (!phoneNumber) return [];

        const normalized = phoneNumber.replace(/\s+/g, "");
        if (phoneCache.has(normalized)) {
            return phoneCache.get(normalized);
        }

        const token = await getAccessToken();
        const results = await findContactByPhone(normalized, token);
        phoneCache.set(normalized, results);
        return results;
    }

    // ===== EXAMPLE USAGE HOOK =====
    // Here you decide WHEN and HOW to call lookupPhone(phoneNumber)
    // For demo, we just expose it on window and log a test number.

    async function demo() {
        // Replace with the phone number you want to test
        const testNumber = "+393331234567";

        try {
            const results = await lookupPhone(testNumber);
            if (results.length > 0) {
                console.log("[Contacts] Match found for", testNumber, results);
            } else {
                console.log("[Contacts] No match for", testNumber);
            }
        } catch (e) {
            console.error("[Contacts] Error during lookup:", e);
        }
    }

    // Expose helper so you can call it from the console or other parts of the script
    window.googleContactsLookupPhone = lookupPhone;

})();
