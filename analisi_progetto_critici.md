# 📋 Report di Audit del Codice: BabyGuard

Questo report riassume l'analisi statica e l'audit dell'intera base di codice del progetto **BabyGuard**. L'analisi non ha apportato modifiche strutturali o funzionali al codice, ma evidenzia criticità di sicurezza, bug, colli di bottiglia e ridondanze che dovrebbero essere risolti.

---

## 1. Backend (FastAPI / Python)

### ⚠️ Vulnerabilità di Sicurezza Critiche (BOLA & Autenticazione)

> [!CAUTION]
> **Mancata Autenticazione nei Varchi Sensibili**
> *   [main.py:L527-L532](file:///Users/jackross/iomt-lab/backend/BabyGuard/main.py#L527-L532): L'endpoint `GET /neonates/{neonate_id}/thresholds` non prevede autenticazione o autorizzazione. Chiunque in rete può leggere le soglie cliniche dei neonati.
> *   [main.py:L540-L542](file:///Users/jackross/iomt-lab/backend/BabyGuard/main.py#L540-L542): L'endpoint `GET /neonates/{neonate_id}/alerts` è pubblico, consentendo a estranei di scaricare la cronologia degli allarmi clinici di qualsiasi paziente.

> [!WARNING]
> **Accesso Logico non Autorizzato (Broken Object-Level Authorization - BOLA)**
> *   [main.py:L545-L583](file:///Users/jackross/iomt-lab/backend/BabyGuard/main.py#L545-L583) (cronologia biometrica) e [main.py:L584-L617](file:///Users/jackross/iomt-lab/backend/BabyGuard/main.py#L584-L617) (statistiche): Gli endpoint controllano solo se il neonato esiste, ma non se l'utente autenticato è autorizzato a visualizzarne i dati (genitore o pediatra associato). Qualsiasi utente autenticato può accedere alle metriche vitali di qualunque bambino.
> *   [main.py:L619-L693](file:///Users/jackross/iomt-lab/backend/BabyGuard/main.py#L619-L693): Permette a chiunque sia loggato di estrarre l'indice AHI (apnee) di qualsiasi neonato.
> *   [main.py:L534-L538](file:///Users/jackross/iomt-lab/backend/BabyGuard/main.py#L534-L538): Consente a qualsiasi medico registrato di alterare le soglie vitali di un neonato, senza verificare che sia il pediatra effettivamente assegnato a quel paziente.

> [!WARNING]
> **Fuga di Dati in Tempo Reale (Broadcast globale)**
> *   [main.py:L83-L102](file:///Users/jackross/iomt-lab/backend/BabyGuard/main.py#L83-L102): I canali WebSocket `/ws/{neonate_id}` e SSE `/sse/{neonate_id}` accettano il parametro `neonate_id` ma non lo filtrano.
> *   [mqtt_handler.py:L90-L96](file:///Users/jackross/iomt-lab/backend/BabyGuard/mqtt_handler.py#L90-L96): In `process_message`, i dati dei sensori ricevuti via MQTT vengono inviati in broadcast globale a tutti i client connessi (`manager.broadcast` e coda unica `sse_queue`). Di fatto, qualsiasi utente riceve i parametri vitali di tutti i bambini monitorati contemporaneamente.

> [!WARNING]
> **Reverse Proxy Grafana Insicuro (Spoofing di Identità)**
> *   [main.py:L721-L876](file:///Users/jackross/iomt-lab/backend/BabyGuard/main.py#L721-L876) (`grafana_proxy`): Il proxy copia gli header del client senza rimuovere o sovrascrivere preventivamente gli header `X-WEBAUTH-USER`. Un utente malintenzionato può inviare un header contraffatto ed entrare in Grafana come amministratore bypassando la sicurezza.

### 🔑 Segreti Hardcoded (Fuga di Chiavi)
*   [auth.py:L6](file:///Users/jackross/iomt-lab/backend/BabyGuard/auth.py#L6): La chiave di firma JWT (`SECRET_KEY = "BABYGUARD_ULTRA_SECRET_KEY"`) è definita come costante letterale.
*   [influx_manager.py:L6](file:///Users/jackross/iomt-lab/backend/BabyGuard/influx_manager.py#L6): Il token di InfluxDB è hardcoded come valore di fallback in chiaro.

### 📉 Concorrenza e Prestazioni
*   [mqtt_handler.py:L486-L563](file:///Users/jackross/iomt-lab/backend/BabyGuard/mqtt_handler.py#L486-L563): Il loop `apnea_monitor_loop` esegue ben 5 query sincrone a InfluxDB per ciascun neonato ogni 2 secondi, creando un enorme collo di bottiglia su InfluxDB.
*   [mqtt_handler.py:L541](file:///Users/jackross/iomt-lab/backend/BabyGuard/mqtt_handler.py#L541): Il calcolo della varianza dell'accelerometro (`get_latest_acc_variance`) effettua ad ogni ciclo il parsing dei campioni via CPU, degradando le prestazioni.
*   [main.py:L255](file:///Users/jackross/iomt-lab/backend/BabyGuard/main.py#L255): Utilizzo della libreria bloccante `requests.post()` per inviare le notifiche push all'interno della route asincrona `/send-notification`, bloccando l'event loop di FastAPI.

### 🗑️ Codice Deprecato e File Inutilizzati
*   [models.py:L74](file:///Users/jackross/iomt-lab/backend/BabyGuard/models.py#L74), [auth.py:L21](file:///Users/jackross/iomt-lab/backend/BabyGuard/auth.py#L21), [main.py:L666](file:///Users/jackross/iomt-lab/backend/BabyGuard/main.py#L666): Utilizzo di `datetime.datetime.utcnow()` deprecato in Python 3.12 (sostituire con `datetime.datetime.now(datetime.UTC)`).
*   [test_tags.py](file:///Users/jackross/iomt-lab/backend/test_tags.py): Script di test isolato contenente credenziali fittizie, non integrato nell'applicazione.

---

## 2. Mobile (React Native / Expo)

### ⚠️ Vulnerabilità Critiche di Sicurezza

> [!CAUTION]
> **Esposizione di Chiave Privata Firebase**
> *   [firebase_key.json](file:///Users/jackross/iomt-lab/mobile/BabyGuard/firebase_key.json): Il file dell'Admin SDK di Firebase è inserito all'interno del codice sorgente dell'app. Un utente malintenzionato può facilmente estrarre la chiave privata decompilando l'APK o IPA e prendere controllo amministrativo del database Firebase.

### 🐛 Bug Funzionali
*   [App.tsx:L86-L93](file:///Users/jackross/iomt-lab/mobile/BabyGuard/App.tsx#L86-L93) e [app.json](file:///Users/jackross/iomt-lab/mobile/BabyGuard/app.json): La registrazione delle notifiche fallisce a runtime a causa della mancanza della configurazione `extra.eas.projectId` all'interno del file di configurazione Expo.

### 🏗️ Ridondanze e Criticità Architetturali
*   **Codice Monolitico**: [App.tsx](file:///Users/jackross/iomt-lab/mobile/BabyGuard/App.tsx) contiene oltre 3000 righe di codice che accorpano navigazione, login, grafici storici, chiamate API e gestione dello stato. Andrebbe refattorizzato dividendo l'app in componenti e hook separati.
*   **File Obsoleti**: I file `package.json` e `package-lock.json` nella cartella `/mobile/` esterna sono ridondanti poiche il vero progetto si trova in `/mobile/BabyGuard/`.
*   **IP Statico**: [App.tsx:L163](file:///Users/jackross/iomt-lab/mobile/BabyGuard/App.tsx#L163) contiene un IP di fallback locale cablato (`192.168.1.58`).

---

## 3. Node-RED

### ⚠️ Vulnerabilità di Sicurezza

> [!WARNING]
> **Editor di Flussi non Protetto**
> *   [settings.js:L76](file:///Users/jackross/iomt-lab/nodered/data/settings.js#L76): La configurazione `adminAuth` è disabilitata (commentata). Chiunque può accedere alla porta 1880, visualizzare le credenziali in chiaro inserite nei nodi e modificare i flussi liberamente.

### 🗑️ Ridondanze e Configurazioni Obsolete
*   [flows.json:L146](file:///Users/jackross/iomt-lab/nodered/data/flows.json#L146): Definizione del broker MQTT `10.204.1.95` non referenziato da nessun nodo attivo.
*   [flows.json:L177](file:///Users/jackross/iomt-lab/nodered/data/flows.json#L177): Definizione del broker MQTT `172.20.10.2` non referenziato da nessun nodo attivo.
*   [flows.json:L44](file:///Users/jackross/iomt-lab/nodered/data/flows.json#L44): Configurazione obsoleta di InfluxDB v1 (`"hostname": "127.0.0.1"`), ignorata poiché il nodo usa l'API di InfluxDB v2 a riga 52.

---

## 4. Grafana

### ⚠️ Vulnerabilità di Sicurezza
*   [datasources.yaml:L14](file:///Users/jackross/iomt-lab/grafana/provisioning/datasources/datasources.yaml#L14): Il token amministrativo di InfluxDB è registrato in chiaro in questo file committato all'interno di Git.

### 🗑️ File Rilevati come Doppioni
*   I file [babyguard_dashboard.json](file:///Users/jackross/iomt-lab/grafana/babyguard_dashboard.json) (root della cartella grafana) e [babyguard_dashboard.json](file:///Users/jackross/iomt-lab/grafana/provisioning/dashboards/babyguard_dashboard.json) (sotto dashboards) sono identici. La copia esterna è una ridondanza.

---

## 5. Docker e Infrastruttura

### ⚠️ Vulnerabilità di Sicurezza

> [!WARNING]
> **Broker Mosquitto Aperto Pubblicamente**
> *   [mosquitto.conf:L7](file:///Users/jackross/iomt-lab/mosquitto/config/mosquitto.conf#L7): L'opzione `allow_anonymous true` abbinata all'esposizione della porta `1883` in Docker compose su `0.0.0.0` permette a chiunque in rete di connettersi senza password, ascoltare i dati sensibili o iniettare dati biometrici contraffatti.

### 🐛 Anomalie di Configurazione
*   [docker-compose.yml:L90-L93](file:///Users/jackross/iomt-lab/docker-compose.yml#L90-L93): Ci sono spazi vuoti dopo il simbolo di uguaglianza per le variabili d'ambiente (es. `EXPO_DEVTOOLS_LISTEN_ADDRESS= "0.0.0.0"`), il che può portare a problemi di parsing dei valori.
*   [docker-compose.yml:L100](file:///Users/jackross/iomt-lab/docker-compose.yml#L100): Il comando di avvio automatico di Expo (`command: npx expo start --lan`) è commentato, costringendo ad un avvio manuale.
*   [Dockerfile:L6](file:///Users/jackross/iomt-lab/mobile/Dockerfile#L6) (Mobile): Il pacchetto `git` viene richiesto due volte nella direttiva di installazione `apt-get install`.
