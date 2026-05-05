// --- ZUSTANDSVERWALTUNG (State Management) ---
const zustand = {
    aktuelleWache: "Hilden",
    aktuelleAutobahn: "",
    aktuellerKilometer: NaN,
    gpsAktiv: false,
    letzteGpsZeit: 0,
    koordinaten: { lat: 0, lng: 0 },
    wegZeit: { aktiv: false, startZeit: 0, startKm: 0, messpunkte: [] }
};

let datenLand = [], datenBAB = [], referenzPunkte = [], datenGemeinden = [];
let karte = null;
let kartenMarker = null;
let gpsBeobachterId = null;

// --- SERVICE WORKER REGISTRIEREN ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(err => console.log('SW Fehler:', err));
    });
}

// --- INITIALISIERUNG ---
document.addEventListener("DOMContentLoaded", initialisiereApp);

function initialisiereApp() {
    bindeEreignisse();
    ladeDaten();
    ladeStandardWache();
    wechsleWache(zustand.aktuelleWache);
}

function bindeEreignisse() {
    document.getElementById("btn-theme-switch").addEventListener("click", () => {
        document.body.setAttribute('data-theme', document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });
    
    document.getElementById("gpsBtn").addEventListener("click", wechsleGpsStatus);
    
    document.getElementById("autobahn").addEventListener("change", (e) => {
        zustand.aktuelleAutobahn = e.target.value;
        aktualisiereTabelle();
    });

    document.getElementById("km").addEventListener("input", berechneWerteAusEingabe);
    
    document.querySelectorAll(".wache-btn").forEach(btn => {
        btn.addEventListener("click", (e) => wechsleWache(e.target.dataset.wache));
    });

    document.getElementById("saveWache").addEventListener("change", (e) => {
        if(e.target.checked) localStorage.setItem('standardWache', zustand.aktuelleWache);
        else localStorage.removeItem('standardWache');
    });

    // Navigation & Modals
    document.getElementById("btn-oeffne-karte").addEventListener("click", oeffneKarte);
    document.getElementById("btn-schliesse-karte").addEventListener("click", () => document.getElementById("map-overlay").style.display = "none");
    document.getElementById("btn-berechne-karten-knoten").addEventListener("click", berechneKnotenAusKarte);

    document.getElementById("btn-oeffne-wzt").addEventListener("click", () => wechsleSeite("page-wegzeit"));
    document.getElementById("btn-schliesse-wzt").addEventListener("click", () => wechsleSeite("page-main"));
    document.getElementById("btn-wzt-start").addEventListener("click", starteWegZeitTracker);
    document.getElementById("btn-wzt-stop").addEventListener("click", stoppeWegZeitTracker);
}

function ladeStandardWache() {
    const gespiechert = localStorage.getItem('standardWache');
    if (gespiechert && datenWachen[gespiechert]) {
        zustand.aktuelleWache = gespiechert;
        document.getElementById("saveWache").checked = true;
    }
}

function wechsleSeite(zielId) {
    document.getElementById("page-main").style.display = zielId === "page-main" ? "block" : "none";
    document.getElementById("page-wegzeit").style.display = zielId === "page-wegzeit" ? "block" : "none";
}

// --- DATEN LADEN ---
async function ladeDaten() {
    try {
        const [land, bab, punkte, gemeinden] = await Promise.all([
            fetch('Abschnitt.json').then(res => res.json()),
            fetch('AbschnittBAB.json').then(res => res.json()),
            fetch('BABKM.json').then(res => res.json()),
            fetch('Gemeinden.json').then(res => res.json())
        ]);
        
        datenLand = extrahiereFeatures(land, 'LineString');
        datenBAB = extrahiereFeatures(bab, 'LineString');
        referenzPunkte = extrahiereFeatures(punkte, 'Point');
        datenGemeinden = extrahiereFeatures(gemeinden, 'Polygon');
        
        document.getElementById("gps-info").innerHTML = '✅ Geo-Datenbank geladen';
    } catch (fehler) {
        document.getElementById("gps-info").innerHTML = '❌ Fehler beim Laden der Geo-Dateien.';
    }
}

function extrahiereFeatures(json, type) {
    if (!json || !Array.isArray(json.features)) return [];
    return json.features.filter(f => f.geometry && f.geometry.type.includes(type));
}

// --- HAUPT-LOGIK ---
function wechsleWache(wachenName) {
    zustand.aktuelleWache = wachenName;
    document.querySelectorAll('.wache-btn').forEach(btn => {
        btn.classList.toggle('active-wache', btn.dataset.wache === wachenName);
    });

    const select = document.getElementById("autobahn");
    select.innerHTML = "";
    
    const wachenDaten = datenWachen[wachenName];
    if (wachenDaten && wachenDaten.grenzen) {
        Object.keys(wachenDaten.grenzen).forEach(ab => select.appendChild(new Option(ab, ab)));
        zustand.aktuelleAutobahn = select.value;
    }
    aktualisiereTabelle();
}

function berechneWerteAusEingabe() {
    const kmWert = parseFloat(document.getElementById("km").value.replace(',', '.'));
    zustand.aktuellerKilometer = isNaN(kmWert) ? NaN : kmWert;
    pruefeZustaendigkeit(zustand.aktuelleAutobahn, zustand.aktuellerKilometer);
    aktualisiereTabelle();
}

// --- GPS LOGIK ---
function wechsleGpsStatus() {
    const btn = document.getElementById("gpsBtn");
    const info = document.getElementById("gps-info");

    if (zustand.gpsAktiv) {
        navigator.geolocation.clearWatch(gpsBeobachterId);
        zustand.gpsAktiv = false;
        btn.textContent = "📡 GPS Live-Erfassung starten";
        btn.classList.remove("active");
        info.textContent = "GPS pausiert.";
    } else {
        zustand.gpsAktiv = true;
        btn.textContent = "⏹️ GPS stoppen";
        btn.classList.add("active");
        info.textContent = "⏳ Suche Signal...";

        gpsBeobachterId = navigator.geolocation.watchPosition(pos => {
            // Debouncing: Max alle 2.5 Sekunden auswerten
            if (Date.now() - zustand.letzteGpsZeit > 2500) {
                zustand.letzteGpsZeit = Date.now();
                verarbeiteGpsSignal(pos.coords.latitude, pos.coords.longitude);
            }
        }, err => info.textContent = "❌ GPS-Fehler", { enableHighAccuracy: true });
    }
}

function verarbeiteGpsSignal(lat, lng) {
    zustand.koordinaten = { lat, lng };
    const punkt = turf.point([lng, lat]);
    
    // 1. Gemeinde bestimmen
    document.getElementById("gemeinde").textContent = findeGemeinde(punkt);

    // 2. Nächste Autobahn finden (Turf.js Logik)
    let naechsteLinie = null;
    let kuerzesterAbstand = Infinity;
    let berechneterKm = NaN;

    const alleLinien = [...datenBAB, ...datenLand];
    
    alleLinien.forEach(linie => {
        const gesnappt = turf.nearestPointOnLine(linie, punkt);
        const abstand = gesnappt.properties.dist; // Distanz in km
        
        if (abstand < kuerzesterAbstand && abstand < 0.2) { // Max 200 Meter Toleranz
            kuerzesterAbstand = abstand;
            naechsteLinie = linie;
            
            // Kilometer berechnen (Interpolation Start-KM + Distanz auf der Linie)
            const statAnf = parseFloat(linie.properties.STATANF || 0);
            const distanzAufLinie = gesnappt.properties.location; 
            berechneterKm = statAnf + distanzAufLinie;
        }
    });

    if (naechsteLinie) {
        const strName = (naechsteLinie.properties.STRKL || "") + (naechsteLinie.properties.STRNR || "");
        document.getElementById("autobahn").value = strName;
        zustand.aktuelleAutobahn = strName;
        zustand.aktuellerKilometer = parseFloat(berechneterKm.toFixed(3));
        document.getElementById("km").value = zustand.aktuellerKilometer;
        
        document.getElementById("gps-info").innerHTML = `📍 GPS: ${strName} - KM ${zustand.aktuellerKilometer}`;
        pruefeZustaendigkeit(strName, zustand.aktuellerKilometer);
        aktualisiereTabelle();
        verarbeiteWegZeit(zustand.aktuellerKilometer);
    } else {
        document.getElementById("gps-info").innerHTML = `Keine Autobahn in der Nähe gefunden.`;
    }
}

function findeGemeinde(punkt) {
    for (let g of datenGemeinden) {
        if (turf.booleanPointInPolygon(punkt, g)) {
            return g.properties.GN || g.properties.GEN || "Unbekannt";
        }
    }
    return "-";
}

function pruefeZustaendigkeit(autobahn, km) {
    const wachenDaten = datenWachen[zustand.aktuelleWache];
    const abschnitt = document.getElementById("bereich");
    const meistereiElement = document.getElementById("meisterei");
    
    if (!wachenDaten || !wachenDaten.grenzen[autobahn] || isNaN(km)) {
        abschnitt.textContent = "Keine Daten / Außerhalb";
        abschnitt.style.color = "red";
        return;
    }

    const [start, ende] = wachenDaten.grenzen[autobahn];
    if (km >= start && km <= ende) {
        abschnitt.textContent = "✅ Im Zuständigkeitsbereich";
        abschnitt.style.color = "green";
    } else {
        abschnitt.textContent = "❌ Außerhalb des Bereichs";
        abschnitt.style.color = "red";
    }

    // Meisterei bestimmen
    if (meistereien[autobahn]) {
        const am = meistereien[autobahn].find(m => km >= m.from && km <= m.to);
        if (am) {
            meistereiElement.textContent = am.name;
            document.getElementById("meisterei_adresse").textContent = am.address;
        }
    }
}

function aktualisiereTabelle() {
    const liste = document.getElementById("liste");
    liste.innerHTML = "";
    
    const wachenDaten = datenWachen[zustand.aktuelleWache];
    if (!wachenDaten || !wachenDaten.listen[zustand.aktuelleAutobahn]) return;

    const aufgaben = wachenDaten.listen[zustand.aktuelleAutobahn];
    const kmStr = document.getElementById("km").value;
    const aktuellerKm = kmStr ? parseFloat(kmStr.replace(',', '.')) : NaN;

    aufgaben.forEach(punkt => {
        const tr = document.createElement("tr");
        const punktKm = parseFloat(punkt[2].replace(',', '.'));
        
        // Highlighten, wenn wir in der Nähe sind (± 1km)
        if (!isNaN(aktuellerKm) && Math.abs(aktuellerKm - punktKm) <= 1.0) {
            tr.classList.add("wz-highlight");
        }

        tr.innerHTML = `<td>${punkt[0]}</td><td>${punkt[1]}</td><td>${punkt[2]}</td>`;
        liste.appendChild(tr);
    });

    // Pfeile setzen
    if (wachenDaten.richtungen[zustand.aktuelleAutobahn]) {
        document.getElementById("dir-plus").style.display = "flex";
        document.getElementById("dir-minus").style.display = "flex";
        document.getElementById("dir-plus-text").textContent = wachenDaten.richtungen[zustand.aktuelleAutobahn][0];
        document.getElementById("dir-minus-text").textContent = wachenDaten.richtungen[zustand.aktuelleAutobahn][1];
    }
}

// --- LEAFLET KARTE ---
function oeffneKarte() {
    document.getElementById("map-overlay").style.display = "flex";
    if (!karte) {
        karte = L.map('karte').setView([51.2277, 6.7735], 13); // Startpunkt NRW
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(karte);
    }
    karte.invalidateSize();
}

function berechneKnotenAusKarte() {
    const zentrum = karte.getCenter();
    const punkt = turf.point([zentrum.lng, zentrum.lat]);
    let naechsterKnoten = null;
    let minAbstand = Infinity;

    referenzPunkte.forEach(p => {
        const abstand = turf.distance(punkt, p);
        if (abstand < minAbstand && abstand < 2) { // Suchradius 2km
            minAbstand = abstand;
            naechsterKnoten = p;
        }
    });

    const resDiv = document.getElementById("nk-map-result");
    resDiv.style.display = "block";
    
    if (naechsterKnoten) {
        const prop = naechsterKnoten.properties;
        resDiv.innerHTML = `<div class="nk-box"><strong>Gefunden:</strong> ${prop.Bez || prop.STRNR} - KM ${prop.Kilometer}</div>`;
        document.getElementById("km").value = prop.Kilometer;
        berechneWerteAusEingabe();
    } else {
        resDiv.innerHTML = `<div class="nk-box" style="color:red;">Kein Netzknoten in direkter Nähe gefunden.</div>`;
    }
}

// --- WEG-ZEIT TRACKER ---
function starteWegZeitTracker() {
    if (isNaN(zustand.aktuellerKilometer)) {
        alert("Bitte warte auf ein GPS Signal oder gib manuell einen Kilometer ein.");
        return;
    }
    zustand.wegZeit.aktiv = true;
    zustand.wegZeit.startZeit = Date.now();
    zustand.wegZeit.startKm = zustand.aktuellerKilometer;
    zustand.wegZeit.messpunkte = [];
    
    document.getElementById("btn-wzt-start").style.display = "none";
    document.getElementById("btn-wzt-stop").style.display = "block";
    document.getElementById("wzt-status").textContent = "Aktiv 🟢";
    document.getElementById("wzt-liste").innerHTML = "";
}

function stoppeWegZeitTracker() {
    zustand.wegZeit.aktiv = false;
    document.getElementById("btn-wzt-start").style.display = "block";
    document.getElementById("btn-wzt-stop").style.display = "none";
    document.getElementById("wzt-status").textContent = "Gestoppt 🔴";
}

function verarbeiteWegZeit(aktuellerKm) {
    if (!zustand.wegZeit.aktiv) return;
    
    const jetzt = Date.now();
    const diffStunden = (jetzt - zustand.wegZeit.startZeit) / 1000 / 3600;
    const diffKm = Math.abs(aktuellerKm - zustand.wegZeit.startKm);
    
    if (diffStunden > 0) {
        const geschwindigkeit = (diffKm / diffStunden).toFixed(1);
        document.getElementById("wzt-speed").textContent = geschwindigkeit;
        document.getElementById("wzt-km").textContent = aktuellerKm;

        // Neuen Eintrag in der Tabelle erstellen
        const tr = document.createElement("tr");
        const zeitString = new Date(jetzt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        tr.innerHTML = `<td>${zeitString}</td><td>${aktuellerKm}</td><td>+ ${diffKm.toFixed(2)} km</td>`;
        document.getElementById("wzt-liste").prepend(tr);
    }
}