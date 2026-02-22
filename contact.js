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

    function showNoBB(row) {
       // Prevent duplicate overlay
       if (document.getElementById('tm-no-bb-overlay')) return;

       // Create overlay div
       const div = document.createElement('div');
       div.id = 'tm-no-bb-overlay';
       div.style.cssText = `
           position: fixed;
           top: 0;
           left: 0;
           width: 100%;
           background: red;
           color: white;
           padding: 15px;
           z-index: 999999;
           display: flex;
           justify-content: space-between;
           align-items: center;
           font-family: sans-serif;
           box-shadow: 0 4px 10px rgba(0,0,0,0.4);
       `;

       // Add the text
       const text = document.createElement('span');
       text.textContent = 'NO_BB match: ' + row[1];
       text.style.fontWeight = 'bold';
       text.style.fontSize = '18px';
       div.appendChild(text);

       // Add close button
       const closeBtn = document.createElement('button');
       closeBtn.textContent = '✕'; // X symbol
       closeBtn.style.cssText = `
           background: white;
           color: red;
           border: none;
           padding: 5px 10px;
           font-size: 16px;
           cursor: pointer;
       `;
       closeBtn.onclick = () => div.remove();
       div.appendChild(closeBtn);

       // Append to body
       document.body.appendChild(div);
   }

    function checkNoBB(APIKEY, SHEET_ID, phone) {
        const RANGE = "NO_BB!A2:D500";
        GM_xmlhttpRequest({
            method: "GET",
            url: `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${RANGE}?key=${APIKEY}`,
            onload: function(response) {
                const data = JSON.parse(response.responseText);
                for (const row of data.values) {
                    if (row[0] === phone) {
                        showNoBB(row);
                    }
                }
            }
        });
    }
    
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
    window.checkNoBB = checkNoBB
})();
