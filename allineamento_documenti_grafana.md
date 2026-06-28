# Allineamento Documentazione - Aggiornamenti Grafana e Gestione Allarmi

Questo documento descrive le modifiche apportate al sistema **BabyGuard** relative alla visualizzazione dello **Storico Anomalie / Alert Clinici** in Grafana e alla nomenclatura degli allarmi nel backend. Fornisce inoltre i testi e le sezioni specifiche da aggiungere/aggiornare nei documenti ufficiali del progetto: `Documento_Requisiti_Software_BabyGuard.pdf` (SRS) e `Documento_del_Design_di_Dettaglio_BabyGuard.pdf` (DDD).

---

## 📌 Sommario delle Modifiche Apportate

1. **Gestione Nomenclatura Allarmi (Backend - InfluxDB):**
   * Il backend Python (`mqtt_handler.py`) scrive ora su InfluxDB i tipi di allarme utilizzando **stringhe estese e parlanti in italiano** nel tag `alert_type`, anziché sigle abbreviate (es. `"HR"`, `"BR"`).
   * Tipi reali registrati:
     * `ALLARME APNEA GRAVE (SIDS)` (invece di `SIDS` / `Apnea`)
     * `EMERGENZA CLINICA ALTE` (invece di `ALTE`)
     * `ALLARME BRADICARDIA` / `ALLARME TACHICARDIA` (invece di `HR`)
     * `ALLARME RESPIRAZIONE DEBOLE` / `ALLARME IPERVENTILAZIONE` (invece di `BR`)
     * `ALLARME POSIZIONE PRONA` (invece di `Position`)
     * `ALLARME BATTERIA SCARICA` (invece di `Battery`)

2. **Dashboard Clinica Grafana (Pannello Storico Anomalie):**
   * **Inizializzazione all'avvio:** La variabile globale `shirt_id` (Bambino) è ora pre-configurata su `tshirt001` per garantire il popolamento immediato della tabella e dei grafici all'avvio.
   * **Caricamento Storico:** La query Flux del pannello usa un range temporale fisso di **30 giorni** (`|> range(start: -30d)`), svincolato dal selettore temporale in alto a destra, per mostrare sempre l'elenco cronologico degli allarmi all'avvio.
   * **Raggruppamento (Ungrouping):** Aggiunta l'istruzione `|> group()` a valle del pivot Flux per forzare l'unione dei dati ed esporre correttamente la colonna `Tipo Allarme` (`alert_type`) in Grafana.
   * **Filtraggio Specifico:** Abilitato il column filter nativo di Grafana (`"enableFilter": true`) disattivando esplicitamente tramite override (`custom.filterable: false`) il filtraggio sulle colonne *Data/Ora Evento*, *Descrizione* e *Gravità*, lasciando attivo e visibile il filtro **esclusivamente sulla colonna "Tipo Allarme"**.

---

## 📝 1. Cosa aggiungere nel Documento dei Requisiti (SRS)
*Sezione di riferimento consigliata: 3.2 Requisiti Funzionali - Requisiti della Dashboard Clinica (Grafana)*

> ### [Aggiunta] RF-MON-08: Filtraggio Storico Anomalie Cliniche
> Il sistema deve fornire nella dashboard clinica del pediatra un pannello dedicato allo **Storico Anomalie / Alert Clinici**. Il pannello deve rispettare i seguenti criteri funzionali:
> 1. **Visualizzazione Iniziale:** All'apertura della dashboard, il pannello deve mostrare in ordine cronologico decrescente tutti gli allarmi registrati negli ultimi 30 giorni per il neonato selezionato.
> 2. **Nomenclatura Chiara:** Ciascuna anomalia deve essere chiaramente classificata tramite messaggi descrittivi estesi in lingua italiana (es. *ALLARME APNEA GRAVE (SIDS)*, *ALLARME BRADICARDIA*, *ALLARME TACHICARDIA*, *ALLARME RESPIRAZIONE DEBOLE*, *ALLARME IPERVENTILAZIONE*, *ALLARME POSIZIONE PRONA*, *ALLARME BATTERIA SCARICA*).
> 3. **Filtraggio Integrato:** La tabella deve includere un filtro di ricerca nativo associato **esclusivamente alla colonna "Tipo Allarme"**.
> 4. **Ripristino Stato:** L'utente deve poter selezionare una categoria di allarme dal filtro per isolare i record corrispondenti e, successivamente, deselezionare il filtro per ritornare istantaneamente alla visualizzazione completa di tutti gli allarmi.

---

## 📐 2. Cosa aggiungere nel Documento di Design di Dettaglio (DDD)
*Sezione di riferimento consigliata: 4. Component Design - Integration and Data Visualization (Grafana)*

> ### [Aggiornamento] Sezione 4.3 - Visualizzazione Tabellare degli Alert Clinici
> Il pannello "Storico Anomalie / Alert Clinici" è implementato come pannello di tipo **Table** di Grafana (v10+). Al fine di garantire l'integrità del filtraggio nativo per categoria ed evitare discrepanze tra i tag di InfluxDB e l'interfaccia, sono applicati i seguenti dettagli implementativi:
> 
> #### 4.3.1 Query Flux di Estrazione
> Per ovviare al comportamento predefinito di InfluxDB che restituisce i tag in tabelle grouped separate (impedendo a Grafana di visualizzarli como colonne), la query Flux applica una trasformazione di flatting tramite l'operatore `group()` a valle del `pivot`:
> 
> ```flux
> from(bucket: "babyguard_bucket")
>   |> range(start: -30d)
>   |> filter(fn: (r) => r["_measurement"] == "alerts")
>   |> filter(fn: (r) => r["shirt_id"] == "${shirt_id}")
>   |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
>   |> keep(columns: ["_time", "alert_type", "message", "severity"])
>   |> group()
>   |> sort(columns: ["_time"], desc: true)
> ```
> 
> #### 4.3.2 Configurazione dei Filtri di Colonna (Overrides JSON)
> Il filtro nativo di raggruppamento e ricerca del pannello Table viene ristretto alla sola colonna `alert_type` configurando gli overrides a livello di schema JSON della dashboard. Le altre colonne vengono disabilitate impostando la proprietà `custom.filterable` a `false`:
> 
> * **Colonna `_time` (Data/Ora Evento):** `custom.filterable: false`
> * **Colonna `message` (Descrizione):** `custom.filterable: false`
> * **Colonna `severity` (Gravità):** `custom.filterable: false`
> * **Colonna `alert_type` (Tipo Allarme):** `custom.filterable: true`

---

## 📲 3. Cosa aggiungere nel DDD (Sezione Telegram Integration)
*Sezione di riferimento consigliata: 4.5 Component Design - Telegram Bot Services*

> ### [Aggiunta] Sezione 4.5.3 - Gestione Persistenza Messaggi al Riavvio (Offset Protection)
> Per prevenire disallineamenti di associazione e la ricezione di messaggi di errore indesiderati (come *"Codice non valido o scaduto"*) causati dalla ricezione di vecchi comandi `/start <codice>` rimasti nella coda di Telegram, all'avvio del bot viene eseguita una procedura di sincronizzazione dell'offset di polling:
> 
> 1. **Consumo dei Messaggi Pregressi:** All'avvio del loop di polling (`start_telegram_polling`), viene eseguita una richiesta API preliminare a `getUpdates` impostando il parametro `offset: -1`.
> 2. **Aggiornamento Offset:** Questa chiamata comunica a Telegram di contrassegnare come letti tutti i messaggi inviati mentre il bot era offline, impostando l'offset locale all'ID dell'ultimo messaggio + 1.
> 3. **loop di Polling Attivo:** Il bot riceverà ed elaborerà in tempo reale esclusivamente i nuovi messaggi inviati a partire dall'avvio del backend, mantenendo intatte le associazioni utente persistite nel database SQLite.
