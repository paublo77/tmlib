window.TMLib = (function () {
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
    const REDIRECT_URI = window.location.origin + "/oauth/tm-lib-capture";
    const SCOPES = "https://www.googleapis.com/auth/contacts.readonly";

    const TOKEN_KEY = "google_contacts_access_token";

    // ===== TOKEN MANAGEMENT =====

    async function getAccessToken() {
        // 1. Return cached token if still valid
        const saved = await GM.getValue(TOKEN_KEY);
        if (saved && saved.expiry > Date.now()) {
            return saved.token;
        }
    
        return new Promise((resolve, reject) => {
            const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=token&scope=${encodeURIComponent(SCOPES)}`;
    
            // 2. Setup Listener for the "Shout Back"
            const handleMessage = (event) => {
                if (event.data && event.data.type === 'GOOGLE_AUTH_SUCCESS') {
                    window.removeEventListener('message', handleMessage);
                    resolve(event.data.token);
                }
            };
            window.addEventListener('message', handleMessage);
    
            // 3. Fallback: Monitor GM Storage (In case window.opener is severed by COOP)
            const storageTimer = setInterval(async () => {
                const tokenData = await GM.getValue(TOKEN_KEY);
                if (tokenData && tokenData.expiry > Date.now()) {
                    clearInterval(storageTimer);
                    window.removeEventListener('message', handleMessage);
                    resolve(tokenData.token);
                }
            }, 1000);
    
            // 4. Open the window (We don't care about the return value anymore)
            window.open(authUrl, '_blank', 'width=500,height=600');
        });
    }    

    // ===== PEOPLE API: SEARCH BY PHONE =====

    async function findContactByPhone(phoneNumber) {
        try {
            const token = await getAccessToken();
            const headers = { 'Authorization': `Bearer ${token}` };
    
            // STEP 1: Warmup (required by People API for search functionality)
            await fetch('https://people.googleapis.com/v1/people:searchContacts?query=&readMask=names,phoneNumbers', { headers });
    
            // Optional: wait 500ms for cache to stabilize
            await new Promise(r => setTimeout(r, 500));
    
            // STEP 2: Actual Search
            // Format: query should be the phone number. 
            // Note: Google recommends removing the '+' for more reliable matches.
            const cleanPhone = phoneNumber.replace(/\+/g, '');
            const searchUrl = `https://people.googleapis.com/v1/people:searchContacts?query=${encodeURIComponent(cleanPhone)}&readMask=names,phoneNumbers`;
    
            const response = await fetch(searchUrl, { headers });
            const data = await response.json();
    
            if (data && data.results && data.results.length > 0) {
                return data.results.map(r => ({
                    name: r.person.names?.[0]?.displayName || 'Unknown',
                    phones: r.person.phoneNumbers?.map(p => p.value) || []
                }));
            } else {
                console.log("No matching contacts found.");
            }
            return [];
        } catch (err) {
            console.error('Contact lookup failed:', err);
        }
    }

    // Expose helper so you can call it from the console or other parts of the script
    return {
        checkNoBB,
        findContactByPhone
    };
})();
