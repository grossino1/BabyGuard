# 👶 BabyGuard - Sistema IoMT Locale di Monitoraggio Neonatale

BabyGuard è un'architettura IoMT (Internet of Medical Things) completamente locale e indipendente dal cloud per il monitoraggio in tempo reale dei parametri vitali dei neonati. Il sistema rileva anomalie cliniche critiche come apnee ostruttive (età-dipendenti via PCA), bradicardia estrema, ipertermia/ipotermia, posizioni a rischio SIDS (prona) e cadute accidentali, notificando tempestivamente i genitori e i pediatri tramite WebSocket e un Bot Telegram dedicato.

---

## 🏗️ Architettura del Sistema

Il sistema si compone dei seguenti moduli integrati:
1. **Smart Shirt & Sensori NTC (ESP32)**: La maglietta intelligente acquisisce i dati fisiologici ed invia i segnali tramite MQTT. I sensori di temperatura esterni NTC, gestiti da un microcontrollore ESP32, compensano l'assenza del sensore di temperatura nativo nella maglietta.
2. **Broker MQTT (Eclipse Mosquitto)**: Gestisce lo smistamento dei messaggi in ingresso inviati dai dispositivi.
3. **Database Temporale (InfluxDB)**: Archivia i dati dei sensori (battito cardiaco, respirazione, temperatura, orientamento e accelerometro) per analisi storiche e calcolo degli indici clinici (es. AHI - Indice di Apnea-Ipopnea).
4. **Database Relazionale (SQLite)**: Memorizza i dati anagrafici dei neonati, le credenziali dei genitori/pediatri, le soglie cliniche personalizzate e lo storico degli allarmi.
5. **FastAPI Backend**: Il cuore logico dell'applicazione. Elabora i dati live, esegue gli algoritmi medici, calcola l'età PCA dei neonati, gestisce le API REST e i canali WebSocket/SSE per lo streaming in tempo reale dei dati.
6. **Telegram Bot**: Invia notifiche di allerta push in modo sicuro e centralizzato agli utenti associati ai neonati.
7. **Node-RED & Grafana**: Utilizzati per l'orchestrazione aggiuntiva dei flussi e per la visualizzazione delle dashboard cliniche per i pediatri.
8. **App Mobile (React Native / Expo Go)**: L'interfaccia utente per genitori e medici, operante su rete locale tramite WebSocket (nessuna dipendenza da EAS/Expo Cloud).

---

## 📂 Struttura della Directory di Consegna

Il progetto è organizzato nel seguente modo per la consegna:
* 📂 **`backend/`**: Logica del server in Python (FastAPI, SQLite, algoritmi clinici).
* 📂 **`mobile/`**: Codice sorgente dell'applicazione mobile in React Native (Expo).
* 📂 **`nodered/`** & **`grafana/`**: File di configurazione, flussi ed provisioning per la visualizzazione delle dashboard cliniche.
* 📂 **`documentazione/`**: Contiene la documentazione formale del progetto (Requisiti SRS, Design di Dettaglio DDD, Presentazione PDF, Proposta di Progetto).
* 📂 **`video funzionamento app/`**: Video dimostrativi MP4 che mostrano l'associazione Telegram, la registrazione, l'interfaccia genitore e pediatra.
* 📂 **`algoritmi e fonti/`**: I 12 PDF scientifici di riferimento clinico (linee guida SIN, ERC, WHO, ecc.) e la specifica degli algoritmi.
* 📂 **`mosquitto/`**: File di configurazione del broker MQTT locale.
* 📂 **`simulazioni/`**: Contiene gli script Python per la simulazione della maglietta intelligente in diversi scenari clinici (sano, critico, anomalo) e i testi di esempio dei messaggi MQTT.
* 📂 **`hardware/`**: Contiene il codice MicroPython (`InvioTemperaturaNTC.py`) da caricare sulla scheda ESP32 reale per la lettura del sensore di temperatura cutanea.

---

## 🛠️ Schema di Collegamento Hardware (Sensori NTC + ESP32)

Per implementare la rilevazione della temperatura cutanea del neonato, viene utilizzato lo script MicroPython [InvioTemperaturaNTC.py](file:///Users/jackross/iomt-lab/hardware/InvioTemperaturaNTC.py) caricato su un **ESP32**.

### Componenti Necessari
* 1x Scheda ESP32 (es. NodeMCU o ESP32-WROOM-32)
* 2x Termistori NTC da 10k (Beta valore tipico 3950)
* 2x Resistenze fisse da 10k (per il partitore di tensione)
* 1x Breadboard e cavetti di collegamento (Jumper)

### Schema sulla Breadboard (Partitore di Tensione)
Per ciascun sensore NTC, è necessario configurare un partitore di tensione per tradurre la variazione di resistenza in una variazione di tensione leggibile dai pin ADC dell'ESP32.

```text
       [ 3.3V ] (VCC dell'ESP32)
          │
          ├──[ Resistenza NTC 10k ]───┬───[ ADC Pin (GPIO 32 o 33) ]
          │                           │
          │                     [ Resistenza 10k ]
          │                           │
          │                        [ GND ]
```

* **Sensore NTC 1 (tshirt001)**:
  * Collegare un capo del termistore NTC a **3.3V**.
  * Collegare l'altro capo all'ingresso analogico **GPIO 32** dell'ESP32.
  * Collegare lo stesso punto (GPIO 32) a una resistenza da 10k collegata a **GND**.
* **Sensore NTC 2 (tshirt002)**:
  * Stesso collegamento del Sensore 1, ma collegando il nodo centrale all'ingresso analogico **GPIO 33**.

---

## 🚀 Configurazione ed Avvio del Software

Per avviare ed eseguire i test del sistema completo BabyGuard, seguire questi semplici passi in ordine:

### Passo 0: Configurazione Rete e File `.env`
Assicurarsi che il proprio computer e lo smartphone siano connessi alla **stessa rete Wi-Fi (LAN)**. 
Modificare il file `.env` (o `.env.local` nell'app mobile) specificando il corretto indirizzo IP locale del proprio computer, in modo che l'app mobile possa raggiungere il backend.

---

### Passo 1: Avvia l'Infrastruttura locale (Docker)
Aprire una finestra del terminale nella cartella principale del progetto (`iomt-lab`) ed avviare i servizi infrastrutturali escludendo il container mobile (che verrà avviato localmente sul computer tramite Expo):
```bash
docker compose up -d --build mosquitto nodered influxdb grafana backend
```
*Questo comando compilerà e avvierà in background Mosquitto (broker), Node-RED, InfluxDB, Grafana e il backend FastAPI Python (il quale eseguirà automaticamente le migrazioni del database SQLite `backend/babyguard.db`).*

---

### Passo 2: Avvia l'App Mobile (Locale)
Aprire una seconda finestra del terminale e posizionarsi nella cartella del frontend mobile per installare le dipendenze (se è il primo avvio) ed avviare il server di sviluppo Expo:
```bash
cd mobile/BabyGuard
# Se è il primo avvio, lanciare: npm install
npx expo start --go --lan
```
**Cosa fare sullo smartphone:**
1. Aprire l'applicazione **Expo Go** (disponibile su Google Play Store e Apple App Store).
2. Inquadrare il **QR Code** stampato sul terminale con la fotocamera per caricare l'applicazione.
3. Se necessario, è possibile inserire manualmente l'indirizzo IP locale visualizzato a terminale.

---

### Passo 3: Avvia il Simulatore dei Dati
Per simulare l'invio delle telemetrie fisiologiche dei neonati dalle magliette, aprire una terza finestra del terminale nella cartella principale del progetto (`iomt-lab`) ed eseguire lo script all'interno della cartella `simulazioni`:
```bash
python3 simulazioni/simulate_anomalous.py
# oppure
cd simulazioni && python3 simulate_anomalous.py
```
*Questo script simulerà a rotazione tutti gli scenari clinici (apnea, bradicardia, febbre, cadute) per verificare all'istante il funzionamento degli allarmi sull'app e su Telegram.*

---

### 📲 Configurazione Bot Telegram (Opzionale)
Il bot Telegram è preconfigurato per utilizzare l'account demo `@BabyGuardNotifyBot`.
Se si desidera utilizzare il proprio bot Telegram:
1. Creare un bot tramite `@BotFather` su Telegram e ottenere il **Token API**.
2. Modificare il file `.env` inserendo `TELEGRAM_BOT_TOKEN=il_tuo_token_qui`.
3. Riavviare il backend di Docker.

---

### 🔧 Configurazione dell'ESP32 Reale (MicroPython)
Se si collegano i sensori hardware reali:
1. Aprire il file [InvioTemperaturaNTC.py](file:///Users/jackross/iomt-lab/hardware/InvioTemperaturaNTC.py).
2. Modificare le variabili in testa al file con le credenziali della propria rete Wi-Fi locale ed il Broker MQTT:
   ```python
   WIFI_SSID = 'Nome_Tua_Rete_WiFi'
   WIFI_PASS = 'Password_Tua_Rete_WiFi'
   MQTT_BROKER = 'Indirizzo_IP_Del_Computer_Con_Docker'
   ```
3. Flashare il file sull'ESP32 rinominandolo in `main.py` per farlo avviare automaticamente all'accensione della scheda.

---

## 🧪 Simulazione e Test delle Anomalie

In assenza di dispositivi hardware reali, è possibile simulare l'invio di dati fisiologici critici o normali tramite gli script Python inclusi nella radice.

### Avviare la Simulazione Completa (Raccomandato)
Lo script `simulate_anomalous.py` simula a rotazione tutte le anomalie configurate (Respiro periodico, Bradicardia estrema, Cadute con immobilità, Febbre/Ipotermia, Apnee) per verificare il corretto comportamento dell'app e la ricezione immediata degli allarmi:
```bash
python simulate_anomalous.py
```
*Questo script invierà dati MQTT al Broker locale simulando 3 magliette (`tshirt001`, `tshirt002`, `tshirt003`).*

### Altri Script di Simulazione
* `python simulate_healthy.py`: Simula parametri fisiologici perfettamente stabili e normali.
* `python simulate_critical.py`: Simula un arresto cardiaco o arresto respiratorio prolungato immediato.
* `python simulate_smartshirt.py`: Simula un flusso standard di dati continui della maglietta.

---

## 📄 Descrizione dei File di Codice Principali

* [backend/BabyGuard/main.py](file:///Users/jackross/iomt-lab/backend/BabyGuard/main.py): Gestore principale delle API, WebSocket, ed endpoint di integrazione Grafana/Telegram.
* [backend/BabyGuard/mqtt_handler.py](file:///Users/jackross/iomt-lab/backend/BabyGuard/mqtt_handler.py): Ascolta i messaggi MQTT dei dispositivi, popola InfluxDB e analizza live le metriche scatenando gli allarmi.
* [backend/BabyGuard/influx_manager.py](file:///Users/jackross/iomt-lab/backend/BabyGuard/influx_manager.py): Gestore delle query a InfluxDB, incluse le funzioni per estrarre finestre accelerometriche (`get_acc_window`) e le pause respiratorie (`get_breath_gaps`).
* [backend/BabyGuard/telegram_bot.py](file:///Users/jackross/iomt-lab/backend/BabyGuard/telegram_bot.py): Gestisce il ciclo di polling del bot Telegram e l'associazione sicura tramite deep-link/codice a 6 cifre.
* [mobile/BabyGuard/App.tsx](file:///Users/jackross/iomt-lab/mobile/BabyGuard/App.tsx): Interfaccia grafica dell'applicazione mobile con gestione del glossario collassabile, grafici live e notifiche di sistema locali.