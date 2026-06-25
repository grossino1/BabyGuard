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

## 🛠️ Schema di Collegamento Hardware (Sensori NTC + ESP32)

Per implementare la rilevazione della temperatura cutanea del neonato, viene utilizzato lo script MicroPython [InvioTemperaturaNTC.py](file:///Users/jackross/iomt-lab/InvioTemperaturaNTC.py) caricato su un **ESP32**.

### Componenti Necessari
* 1x Scheda ESP32 (es. NodeMCU o ESP32-WROOM-32)
* 2x Termistori NTC da $10\text{ k}\Omega$ (Beta valore tipico $3950$)
* 2x Resistenze fisse da $10\text{ k}\Omega$ (per il partitore di tensione)
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
  * Collegare lo stesso punto (GPIO 32) a una resistenza da $10\text{ k}\Omega$ collegata a **GND**.
* **Sensore NTC 2 (tshirt002)**:
  * Stesso collegamento del Sensore 1, ma collegando il nodo centrale all'ingresso analogico **GPIO 33**.

---

## 🚀 Configurazione ed Avvio del Software

### 1. Avviare l'Infrastruttura Locale (Docker)
Assicurarsi di avere Docker e Docker Compose installati, quindi posizionarsi nella cartella principale ed avviare tutti i servizi infrastrutturali locali:
```bash
docker-compose up -d --build
```
Questo comando avvierà in background:
* **Mosquitto** (porta `1883`)
* **InfluxDB** (porta `8086`)
* **Grafana** (porta `3000`)
* **Node-RED** (porta `1880`)
* **FastAPI Backend** (porta `8000`)

Il backend eseguirà automaticamente le migrazioni del database SQLite locale (`backend/babyguard.db`).

### 2. Configurare ed Avviare l'App Mobile
Spostarsi nella cartella dell'applicazione mobile ed installare le dipendenze:
```bash
cd mobile/BabyGuard
npm install
```
Avviare il server di sviluppo Expo Go:
```bash
npm run dev
# oppure
npx expo start
```
Inquadrare il QR code generato tramite l'app **Expo Go** sul proprio smartphone (iOS o Android) per visualizzare l'applicazione. 
* *Nota*: Assicurarsi che lo smartphone sia connesso alla **stessa rete Wi-Fi** del computer che esegue il backend. Inserire l'indirizzo IP del computer nella configurazione iniziale dell'applicazione se richiesto.

### 3. Configurare ed Avviare il Bot Telegram
Il bot Telegram è preconfigurato per utilizzare l'account demo `@BabyGuardNotifyBot`.
* Per avviare il bot in locale (se non si usa Docker per il backend), eseguire:
  ```bash
  python -m backend.BabyGuard.telegram_bot
  ```
* Se si desidera utilizzare il proprio bot Telegram:
  1. Creare un bot tramite `@BotFather` su Telegram e ottenere il **Token API**.
  2. Modificare il file `.env` inserendo `TELEGRAM_BOT_TOKEN=il_tuo_token_qui`.
  3. Riavviare the backend.

### 4. Configurare l'ESP32 (MicroPython)
1. Aprire il file [InvioTemperaturaNTC.py](file:///Users/jackross/iomt-lab/InvioTemperaturaNTC.py).
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