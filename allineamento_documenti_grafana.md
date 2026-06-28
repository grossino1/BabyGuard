# Allineamento Documentazione - BabyGuard
## Riferimenti per `Documento_Requisiti_Software_BabyGuard.pdf` e `Documento_del_Design_di_Dettaglio_BabyGuard.pdf`

Questo documento definisce con precisione chirurgica **dove e cosa aggiungere** all'interno dei due documenti ufficiali di progetto, in base alle modifiche apportate alla Dashboard Grafana, al backend Python per la nomenclatura degli allarmi ed all'offset protection per il bot Telegram.

---

## 📝 Parte 1: Integrazioni per `Documento_Requisiti_Software_BabyGuard.pdf` (SRS)

### 📍 Posizione 1: Capitolo 3, Sezione 3.2 "Funzionalità Individuali (IF)" - Pagina 8
*Inserire in coda all'elenco dei requisiti `IF` (subito sotto `IF-1.12`) il seguente nuovo requisito:*

* **ID Requisito:** `IF-1.13`
* **Titolo:** Filtraggio e Caricamento Storico Anomalie Cliniche in Dashboard
* **Business Value:** Alto
* **Rischio Tecnico:** Medio
* **Priorità:** Alta
* **Descrizione:** Il sistema deve consentire al pediatra di consultare lo storico di tutte le anomalie degli ultimi 30 giorni relative al neonato selezionato fin dal caricamento iniziale della dashboard. La tabella degli allarmi deve presentare un meccanismo di filtraggio interattivo nativo legato esclusivamente alla colonna "Tipo Allarme". L'utente deve poter isolare una categoria di anomalie e ripristinare la visualizzazione completa disattivando il filtro.

---

### 📍 Posizione 2: Capitolo 3, Sezione 3.2 "Funzionalità Individuali (IF)" - Pagina 8 (Aggiornamento `IF-1.11`)
*Integrare la descrizione del requisito `IF-1.11` (Associazione ed Integrazione con Telegram) aggiungendo in coda la specifica di robustezza:*

> **[Integrazione in coda a IF-1.11]**
> Il sistema deve garantire la persistenza dell'associazione anche in caso di riavvio del server di backend. All'avvio, il bot non deve processare i comandi `/start` storici accumulati offline, evitando l'invio di messaggi di errore spuri (es. *"Codice non valido o scaduto"*).

---

### 📍 Posizione 3: Capitolo 3, Sezione 3.5 "Interfacce Utente (UI)" - Pagina 10
*Inserire in coda all'elenco delle interfacce `UI` (subito sotto `UI-1.7`) la seguente nuova interfaccia:*

* **ID Interfaccia:** `UI-1.8`
* **Titolo:** Pannello Storico Anomalie / Alert Clinici
* **Business Value:** Alto
* **Rischio Tecnico:** Medio
* **Priorità:** Alta
* **Descrizione:** Il pannello deve presentarsi in forma tabellare con le colonne: *Data/Ora Evento*, *Tipo Allarme* (in italiano esteso), *Descrizione* e *Gravità*. In corrispondenza dell'intestazione "Tipo Allarme" deve essere presente un'icona ad imbuto che apre un menu a selezione singola/multipla contenente le categorie reali presenti (es. *ALLARME APNEA GRAVE (SIDS)*, *ALLARME BRADICARDIA*, *ALLARME TACHICARDIA* ecc.). La barra di ricerca globale in calce alla tabella deve essere inibita per evitare la duplicazione disordinata dei filtri.

---

### 📍 Posizione 4: Capitolo 6, "UC-4 – Visualizzazione Dashboard Clinica e Analisi Storica" - Pagina 19
*Integrare la descrizione del Passo 5 del Flusso di eventi principale del caso d'uso UC-4:*

> **[Integrazione al Passo 5 del Flusso Principale di UC-4]**
> 5. Per un'analisi approfondita il Pediatra consulta le dashboard cliniche su Grafana alimentate da InfluxDB. Di base, all'apertura della dashboard clinica il sistema pre-seleziona il neonato di riferimento (`tshirt001`) e carica automaticamente l'intero elenco cronologico degli allarmi degli ultimi 30 giorni nel pannello dedicato allo Storico Anomalie.

---

### 📍 Posizione 5: Capitolo 8, "Matrice di Tracciabilità" - Pagina 24
*Inserire le seguenti due nuove righe all'interno della tabella della Matrice di Tracciabilità:*

| Requisito | Caso d'Uso | Componente / Tecnologia | Verifica |
| :--- | :--- | :--- | :--- |
| **`IF-1.13`** | `UC-4` | Grafana, InfluxDB (query Flux con `group()` e range `-30d`) | Test di caricamento e filtraggio storico allarmi |
| **`UI-1.8`** | `UC-4` | Grafana (Table Panel con overrides `custom.filterable`) | Test di usabilità dei filtri nativi di colonna |

---

## 📐 Parte 2: Integrazioni per `Documento_del_Design_di_Dettaglio_BabyGuard.pdf` (DDD)

### 📍 Posizione 1: Capitolo 1, Sezione 1.1.11 "Modulo Grafana"
*Sostituire la descrizione del modulo con la seguente specifica di configurazione:*

> Il modulo Grafana visualizza la dashboard clinica del pediatra. Il pannello "Storico Anomalie / Alert Clinici" è configurato come **Table Panel** ed effettua query Flux sul database temporale InfluxDB. 
> Per ovviare all'impossibilità di Grafana di rappresentare i tag di InfluxDB come colonne se distribuiti su serie/tabelle grouped differenti, la query Flux applica la funzione di flattening `|> group()` prima dell'ordinamento. La variabile `shirt_id` (Bambino) viene valorizzata all'avvio con il valore di default `tshirt001` per forzare la visualizzazione immediata dei dati all'utente.

---

### 📍 Posizione 2: Capitolo 1, Sezione 1.1.13 "Modulo Notifiche"
*Integrare il paragrafo relativo a Telegram come segue:*

> La notifica push su Telegram è gestita dal modulo [telegram_bot.py](file:///Users/jackross/iomt-lab/backend/BabyGuard/telegram_bot.py). Per garantire un avvio pulito, il bot esegue all'attivazione del loop di polling un getUpdates con `offset: -1` che consuma la coda dei messaggi pregressi accumulati nei server di Telegram durante i tempi di inattività del backend. Questo assicura che solo i nuovi messaggi in tempo reale vengano catturati e processati, mantenendo integra l'associazione memorizzata nel database SQLite locale.

---

### 📍 Posizione 3: Capitolo 2, Sezione 2.4.2 "Database Temporale (InfluxDB) e Schema della Telemetria"
*Aggiungere sotto la definizione dello schema delle misure, lo schema specifico degli allarmi:*

#### Tabella Telemetria - Misura: `alerts`
* **Tag Key:**
  * `shirt_id` (identificativo del wearable associato, es. `tshirt001`)
  * `alert_type` (tipo esteso in italiano dell'evento: `ALLARME APNEA GRAVE (SIDS)`, `EMERGENZA CLINICA ALTE`, `ALLARME BRADICARDIA`, `ALLARME TACHICARDIA`, `ALLARME RESPIRAZIONE DEBOLE`, `ALLARME IPERVENTILAZIONE`, `ALLARME POSIZIONE PRONA`, `ALLARME BATTERIA SCARICA`)
* **Field Key:**
  * `message` (string, messaggio descrittivo esteso dell'allarme)
  * `severity` (string, livello di gravità dell'evento: `high`, `critical`, `medium`)
  * `is_resolved` (integer, `0` per allarme attivo, `1` per allarme risolto)

---

### 📍 Posizione 4: Capitolo 4, Sezione 4.3 "Area Pazienti Pediatra"
*Sotto la descrizione del pannello delle anomalie storiche, inserire le impostazioni JSON del componente:*

> Il componente visualizza le anomalie tramite il Table Panel di Grafana. Il file di configurazione `babyguard_dashboard.json` ne definisce i comportamenti tramite i seguenti parametri chiave:
> * `"enableFilter": true` e `"columnFilter": true` per abilitare i filtri nativi di colonna.
> * A livello di `overrides` di campo, le colonne `_time`, `message` e `severity` hanno la proprietà `custom.filterable` impostata a `false`.
> * La colonna `alert_type` ha la proprietà `custom.filterable` impostata a `true` e il displayName mappato in `"Tipo Allarme"`.
