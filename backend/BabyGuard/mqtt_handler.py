import asyncio
import json
import time
import math
import urllib.request
import aiomqtt
import traceback
from sqlalchemy.ext.asyncio import AsyncSession
from . import models, database, crud, telegram_bot
from .influx_manager import influx_manager
from .models import compute_pca_weeks

MQTT_BROKER = "mosquitto" # Name of the service in docker-compose
MQTT_PORT = 1883
TOPIC_PREFIX = "unisadiem/smartshirt" # Updated to new topic structure

manager = None # Set by main.py
sse_queue = None # Set by main.py

# --- DEVICE STATE FOR CLINICAL ALGORITHMS ---
class DeviceState:
    def __init__(self, device_id: str):
        self.device_id = device_id
        self.last_breath_time = time.time()  # Track last valid breath time
        self.latest_hr = None
        self.latest_hr_ema = None
        self.hr_history = []  # Last 5 heart rates for EMA
        self.latest_var_acc = 15000.0  # Default high variance (normal movements)
        self.last_alert_time = 0  # Rate limit alerts to avoid spam
        self.battery_level = None
        self.battery_charging = None
        self.battery_voltage = None
        
        # Advanced clinical algorithms states
        self.prone_start_time = None
        self.temp_history = []
        self.last_threshold_alerts = {}
        self.last_apnea_alert_type = None
        self.last_apnea_alert_time = 0
        self.last_alte_alert_time = 0
        self.last_position_alert_time = 0
        # --- Nuovi algoritmi: caduta, respiro periodico, bradicardia PCA ---
        self.last_fall_alert_time = 0
        self.last_periodic_alert_time = 0
        self.brady_run_start = None
        self.last_brady_alert_time = 0
        self.is_online = True
        self.last_offline_alert_time = 0

# Global in-memory cache for wearable devices
device_states = {}

async def process_message(topic: str, payload: dict):
    # Support both new topic structure: unisadiem/smartshirt/{device_id}/{type}
    # and old topic structure: unisadiem/dmcs/sensor/{device_id}/{type}
    parts = topic.split("/")
    if len(parts) == 4 and parts[0] == "unisadiem" and parts[1] == "smartshirt":
        device_id = parts[2]
        data_type = parts[3]
    elif len(parts) == 5 and parts[0] == "unisadiem" and parts[1] == "dmcs" and parts[2] == "sensor":
        device_id = parts[3]
        data_type = parts[4]
    else:
        return
    
    # Map TemperatureNTC to TEMPERATURE and format payload as dictionary
    if data_type == "TemperatureNTC":
        data_type = "TEMPERATURE"
        temp_val = None
        if isinstance(payload, (int, float)):
            temp_val = float(payload)
        elif isinstance(payload, str):
            try:
                temp_val = float(payload)
            except ValueError:
                pass
        elif isinstance(payload, dict):
            val = payload.get("temperature") or payload.get("value") or (next(iter(payload.values())) if payload else None)
            try:
                if val is not None:
                    temp_val = float(val)
            except (ValueError, TypeError):
                pass
        
        # If the temperature is invalid, less than or equal to 0, or greater than 60, drop the message
        if temp_val is None or temp_val <= 0 or temp_val > 60:
            print(f"[MQTT] Ignored invalid/out-of-range temperature value: {temp_val}")
            return
            
        payload = {"temperature": temp_val}
    
    message_to_send = {
        "device_id": device_id,
        "type": data_type,
        "data": payload
    }
    
    # Broadcast raw data to WebSockets (Live Monitor)
    if manager:
        await manager.broadcast(message_to_send)
    
    # Push raw data to SSE queue
    if sse_queue:
        await sse_queue.put(message_to_send)

async def perform_threshold_checks(db: AsyncSession, neonate: models.NeonateModel, state: DeviceState, device_id: str, temp_val: float, br_val: float, orientation: int, soc: int, thresholds):
    if not hasattr(state, "last_threshold_alerts"):
        state.last_threshold_alerts = {}

    async def trigger_threshold_alert(alert_type, alert_msg, severity):
        last_sent = state.last_threshold_alerts.get(alert_type, 0)
        if time.time() - last_sent > 30:
            state.last_threshold_alerts[alert_type] = time.time()
            db_alert = await crud.create_alert(db, neonate.id, alert_type, alert_msg, severity)
            print(f"[ALERT THRESHOLD] {neonate.first_name}: {alert_msg}")
            
            alert_message = {
                "event": "alert",
                "neonate_id": neonate.id,
                "device_id": device_id,
                "alert": {
                    "id": db_alert.id,
                    "type": db_alert.type,
                    "message": db_alert.message,
                    "severity": db_alert.severity,
                    "timestamp": db_alert.timestamp.isoformat() if db_alert.timestamp else None,
                    "is_resolved": bool(db_alert.is_resolved)
                }
            }
            
            await send_push_notification(db, neonate, alert_msg)
            if manager:
                await manager.broadcast(alert_message)
            if sse_queue:
                await sse_queue.put(alert_message)

    # 1. Heart Rate Check (Utilizza la media mobile esponenziale EMA per evitare falsi positivi da artefatti)
    hr_val = state.latest_hr_ema if state.latest_hr_ema is not None else state.latest_hr
    if hr_val is not None and hr_val > 0:
        if hr_val < thresholds.hr_min:
            await trigger_threshold_alert("HR", f"⚠️ ALLARME BRADICARDIA\n\nFrequenza cardiaca: {hr_val:.1f} BPM (Sotto la soglia minima di {thresholds.hr_min} BPM).", "critical")
        elif hr_val > thresholds.hr_max:
            await trigger_threshold_alert("HR", f"⚠️ ALLARME TACHICARDIA\n\nFrequenza cardiaca: {hr_val:.1f} BPM (Sopra la soglia massima di {thresholds.hr_max} BPM).", "high")

    # 2. Breath Rate Check
    if br_val is not None and br_val > 0:
        if br_val < thresholds.br_min:
            await trigger_threshold_alert("BR", f"⚠️ RESPIRAZIONE DEBOLE\n\nFrequenza respiratoria: {br_val} atti/min (Sotto la soglia minima di {thresholds.br_min} atti/min).", "critical")
        elif br_val > thresholds.br_max:
            await trigger_threshold_alert("BR", f"⚠️ IPERVENTILAZIONE\n\nFrequenza respiratoria: {br_val} atti/min (Sopra la soglia massima di {thresholds.br_max} atti/min).", "high")

    # 3. Battery Check
    if soc is not None and soc <= 15:
        await trigger_threshold_alert("Battery", f"🪫 BATTERIA SCARICA\n\nLa batteria del dispositivo è al {soc}%. Collegare la maglietta alla carica.", "high")

async def check_position_persistence(db: AsyncSession, neonate: models.NeonateModel, state: DeviceState, device_id: str, orientation: int):
    """
    Rilevamento posizione prona persistente (T_p = 10s) per prevenire la SIDS.
    Se l'orientamento rimane a pancia in giù (16) per almeno 10 secondi, genera l'allarme.
    """
    if orientation is None:
        state.prone_start_time = None
        return

    try:
        orient_int = int(float(orientation))
    except (ValueError, TypeError):
        return

    is_prone = bool(orient_int & 16)
    now = time.time()

    if is_prone:
        if state.prone_start_time is None:
            state.prone_start_time = now
        else:
            elapsed = now - state.prone_start_time
            if elapsed >= 10:  # Finestra temporale di persistenza di 10 secondi
                alert_type = "Position"
                alert_msg = f"⚠️ POSIZIONE PRONA RILEVATA ({int(elapsed)}s)\n\nIl neonato è a pancia in giù da oltre 10 secondi. Si consiglia di rimetterlo in posizione supina (a pancia in su) per prevenire il rischio SIDS."
                severity = "critical"
                
                last_sent = getattr(state, "last_position_alert_time", 0)
                if now - last_sent > 30:
                    state.last_position_alert_time = now
                    db_alert = await crud.create_alert(db, neonate.id, alert_type, alert_msg, severity)
                    print(f"[ALERT POSITION SIDS] {neonate.first_name}: {alert_msg}")
                    
                    alert_message = {
                        "event": "alert",
                        "neonate_id": neonate.id,
                        "device_id": device_id,
                        "alert": {
                            "id": db_alert.id,
                            "type": db_alert.type,
                            "message": db_alert.message,
                            "severity": db_alert.severity,
                            "timestamp": db_alert.timestamp.isoformat() if db_alert.timestamp else None,
                            "is_resolved": bool(db_alert.is_resolved)
                        }
                    }
                    
                    await send_push_notification(db, neonate, alert_msg)
                    if manager:
                        await manager.broadcast(alert_message)
                    if sse_queue:
                        await sse_queue.put(alert_message)
    else:
        state.prone_start_time = None

async def check_temperature_trend(db: AsyncSession, neonate: models.NeonateModel, state: DeviceState, device_id: str, temp_val: float, thresholds):
    """
    Calcola la media mobile a 1 minuto per stabilizzare il sensore di temperatura cutanea.
    - Se supera 37.5°C con trend in costante aumento, genera ALLARME SURRISCALDAMENTO.
    - Se scende sotto 36.0°C, genera ALLARME IPOTERMIA.
    """
    if temp_val is None or temp_val <= 0 or temp_val > 60:
        return

    now = time.time()
    state.temp_history.append((now, temp_val))
    
    # Filtro di stabilità: Mantieni solo le letture dell'ultimo minuto (60 secondi)
    state.temp_history = [(t, v) for t, v in state.temp_history if now - t <= 60]

    if len(state.temp_history) < 2:
        return

    # Calcolo media mobile
    temp_avg = sum(v for _, v in state.temp_history) / len(state.temp_history)
    
    # Determinazione trend: positivo se la temperatura finale è maggiore di quella iniziale dell'ultimo minuto (almeno di 0.05°C)
    first_val = state.temp_history[0][1]
    last_val = state.temp_history[-1][1]
    trend_positive = (last_val - first_val) >= 0.05

    alert_type = None
    alert_msg = ""
    severity = "high"

    # Soglia Ipertermia (default 37.5°C)
    if temp_avg > thresholds.temp_max:
        if trend_positive:
            alert_type = "Hyperthermia"
            alert_msg = f"🔥 ALLARME SURRISCALDAMENTO\n\nTemperatura cutanea media: {temp_avg:.1f}°C (Soglia max: {thresholds.temp_max:.1f}°C). Rilevato un trend in costante crescita. Rischio di ipertermia e aumento del rischio SIDS."
            severity = "critical"
        else:
            alert_type = "Temp"
            alert_msg = f"🌡️ TEMPERATURA ELEVATA\n\nTemperatura cutanea media nell'ultimo minuto: {temp_avg:.1f}°C. Superata la soglia di sicurezza di {thresholds.temp_max:.1f}°C."
            severity = "high"
            
    # Soglia Ipotermia (default 36.0°C)
    elif temp_avg < thresholds.temp_min:
        alert_type = "Hypothermia"
        alert_msg = f"❄️ ALLARME IPOTERMIA\n\nTemperatura cutanea media: {temp_avg:.1f}°C. Discesa sotto la soglia di sicurezza di {thresholds.temp_min:.1f}°C."
        severity = "high"

    if alert_type:
        last_sent = state.last_threshold_alerts.get(alert_type, 0)
        if now - last_sent > 30:
            state.last_threshold_alerts[alert_type] = now
            db_alert = await crud.create_alert(db, neonate.id, alert_type, alert_msg, severity)
            print(f"[ALERT TEMPERATURE] {neonate.first_name}: {alert_msg}")
            
            alert_message = {
                "event": "alert",
                "neonate_id": neonate.id,
                "device_id": device_id,
                "alert": {
                    "id": db_alert.id,
                    "type": db_alert.type,
                    "message": db_alert.message,
                    "severity": db_alert.severity,
                    "timestamp": db_alert.timestamp.isoformat() if db_alert.timestamp else None,
                    "is_resolved": bool(db_alert.is_resolved)
                }
            }
            
            await send_push_notification(db, neonate, alert_msg)
            if manager:
                await manager.broadcast(alert_message)
            if sse_queue:
                await sse_queue.put(alert_message)


def derive_brady_threshold(pca_weeks) -> int:
    """Soglia bpm bradicardia extreme-event (ALTE Q8): <60 se PCA<44 sett, <50 se PCA>=44."""
    if pca_weeks is None:
        return 60
    return 60 if pca_weeks < 44 else 50


def get_neonate_pca(neonate) -> float:
    """Calcola la PCA live da birth_date + gestational_age_weeks."""
    return compute_pca_weeks(
        getattr(neonate, "birth_date", None),
        getattr(neonate, "gestational_age_weeks", None),
    )


# ============================================================================
#  RILEVAMENTO CADUTA (Noury: impatto + immobilita')
#  Scenario neonatale: caduta da culla/letto/braccia (AAP 2022).
#  Scala calibrata sui dati reali ACC_GYRO: 1g ~ 16800 LSB.
# ============================================================================
ACC_LSB_PER_G = 16800.0
FALL_IMPACT_G = 3.0          # DA VALIDARE sul dispositivo reale
FALL_STILL_VAR_MAX = 4.0e6
FALL_STILL_RATIO = 0.6

async def check_fall_detection(db: AsyncSession, neonate: models.NeonateModel, state: DeviceState, device_id: str, acc_samples: list):
    """
    Rilevamento Caduta tramite SVM normalizzato a 16384 LSB/g.
    Sequenza: Caduta Libera (SVM < 0.4g per < 500ms) seguita da Impatto (SVM > 1.8g entro 1s).
    """
    if not acc_samples or len(acc_samples) < 5:
        return

    # 1. Normalizzazione e calcolo SVM
    svms = []
    for s in acc_samples:
        ax = s.get("x", 0.0) / 16384.0
        ay = s.get("y", 0.0) / 16384.0
        az = s.get("z", 0.0) / 16384.0
        svm = math.sqrt(ax*ax + ay*ay + az*az)
        svms.append(svm)

    # Stima del tempo di campionamento (finestra di ~3s)
    dt = 3.0 / len(svms)
    max_ff_samples = max(1, int(0.5 / dt))  # 500ms
    max_impact_samples = max(1, int(1.0 / dt)) # 1s

    free_fall_start = -1
    free_fall_end = -1
    
    alert_type = None
    alert_msg = ""
    severity = "critical"
    peak_val = 0.0

    # Ricerca sequenza: Caduta Libera -> Impatto
    for i, svm in enumerate(svms):
        if svm < 0.4: # Avvio fase di free-fall
            if free_fall_start == -1:
                free_fall_start = i
        else:
            if free_fall_start != -1:
                ff_duration = i - free_fall_start
                if ff_duration <= max_ff_samples: # Controlla durata massima di free-fall (500ms)
                    free_fall_end = i
                free_fall_start = -1

        if free_fall_end != -1:
            if i - free_fall_end <= max_impact_samples: # Controllo impatto entro 1s dalla fine della free-fall
                if svm > 1.8:
                    alert_type = "Fall"
                    peak_val = max(peak_val, svm)
            else:
                free_fall_end = -1

    if alert_type:
        alert_msg = f"🚨 ALLARME CADUTA\n\nRilevata fase di caduta libera seguita da impatto ({peak_val:.1f}g). Verificare immediatamente il neonato!"
        now = time.time()
        last_sent = getattr(state, "last_fall_alert_time", 0)
        
        if now - last_sent > 30:
            state.last_fall_alert_time = now
            
            db_alert = await crud.create_alert(db, neonate.id, alert_type, alert_msg, severity)
            print(f"[ALERT FALL] {neonate.first_name}: {alert_msg}")

            alert_message = {
                "event": "alert",
                "neonate_id": neonate.id,
                "device_id": device_id,
                "alert": {
                    "id": db_alert.id,
                    "type": db_alert.type,
                    "message": db_alert.message,
                    "severity": db_alert.severity,
                    "timestamp": db_alert.timestamp.isoformat() if db_alert.timestamp else None,
                    "is_resolved": bool(db_alert.is_resolved)
                }
            }
            
            await send_push_notification(db, neonate, alert_msg)
            if manager:
                await manager.broadcast(alert_message)
        if sse_queue:
            await sse_queue.put(alert_message)


# ============================================================================
#  RESPIRO PERIODICO (McCoy: >=2 pause <10s entro 20s)
#  Richiede get_breath_gaps in influx_manager (vedi note). PREDISPOSTO.
# ============================================================================
PERIODIC_SHORT_GAP_MAX = 10.0
PERIODIC_MIN_EVENTS = 2

async def check_periodic_breathing(db: AsyncSession, neonate: models.NeonateModel, state: DeviceState, device_id: str, breath_gaps: list):
    """Respiro periodico: >=2 pause respiratorie brevi (<10s) ravvicinate."""
    if not breath_gaps:
        return

    short_gaps = [g for g in breath_gaps if 0 < g < PERIODIC_SHORT_GAP_MAX]
    if len(short_gaps) < PERIODIC_MIN_EVENTS:
        return

    alert_type = "PeriodicBreathing"
    alert_msg = f"⚠️ RESPIRO PERIODICO\n\nRilevate {len(short_gaps)} pause respiratorie brevi (<10s) ravvicinate. Pattern di instabilita' respiratoria da monitorare."
    severity = "medium"

    now = time.time()
    last_sent = getattr(state, "last_periodic_alert_time", 0)
    if now - last_sent > 30:
        state.last_periodic_alert_time = now
        db_alert = await crud.create_alert(db, neonate.id, alert_type, alert_msg, severity)
        print(f"[ALERT PERIODIC BREATHING] {neonate.first_name}: {alert_msg}")

        alert_message = {
            "event": "alert",
            "neonate_id": neonate.id,
            "device_id": device_id,
            "alert": {
                "id": db_alert.id,
                "type": db_alert.type,
                "message": db_alert.message,
                "severity": db_alert.severity,
                "timestamp": db_alert.timestamp.isoformat() if db_alert.timestamp else None,
                "is_resolved": bool(db_alert.is_resolved)
            }
        }

        await send_push_notification(db, neonate, alert_msg)
        if manager:
            await manager.broadcast(alert_message)
        if sse_queue:
            await sse_queue.put(alert_message)


# ============================================================================
#  BRADICARDIA "EXTREME EVENT" PCA-DIPENDENTE (ALTE Q8)
#  HR sotto soglia PCA-dipendente, sostenuta per >=10s.
# ============================================================================
async def check_bradycardia_extreme(db: AsyncSession, neonate: models.NeonateModel, state: DeviceState, device_id: str, pca_weeks):
    """Bradicardia sostenuta sotto soglia PCA-dipendente per >=10s."""
    hr_val = state.latest_hr_ema if state.latest_hr_ema is not None else state.latest_hr
    if hr_val is None or hr_val <= 0:
        state.brady_run_start = None
        return

    brady_bpm = derive_brady_threshold(pca_weeks)
    now = time.time()

    if hr_val < brady_bpm:
        if state.brady_run_start is None:
            state.brady_run_start = now
            return
        elapsed = now - state.brady_run_start
        if elapsed >= 10:
            alert_type = "BradycardiaExtreme"
            alert_msg = f"🚨 BRADICARDIA SOSTENUTA ({int(elapsed)}s)\n\nFrequenza cardiaca sotto {brady_bpm} BPM (attuale: {hr_val:.1f} BPM) da oltre 10 secondi. Evento critico secondo le linee guida ALTE. Intervenire."
            severity = "critical"

            last_sent = getattr(state, "last_brady_alert_time", 0)
            if now - last_sent > 30:
                state.last_brady_alert_time = now
                db_alert = await crud.create_alert(db, neonate.id, alert_type, alert_msg, severity)
                print(f"[ALERT BRADYCARDIA EXTREME] {neonate.first_name}: {alert_msg}")

                alert_message = {
                    "event": "alert",
                    "neonate_id": neonate.id,
                    "device_id": device_id,
                    "alert": {
                        "id": db_alert.id,
                        "type": db_alert.type,
                        "message": db_alert.message,
                        "severity": db_alert.severity,
                        "timestamp": db_alert.timestamp.isoformat() if db_alert.timestamp else None,
                        "is_resolved": bool(db_alert.is_resolved)
                    }
                }

                await send_push_notification(db, neonate, alert_msg)
                if manager:
                    await manager.broadcast(alert_message)
                if sse_queue:
                    await sse_queue.put(alert_message)
    else:
        state.brady_run_start = None


async def mqtt_loop():
    while True:
        try:
            async with aiomqtt.Client(MQTT_BROKER, MQTT_PORT) as client:
                # Subscribe to both topic patterns
                await client.subscribe("unisadiem/dmcs/sensor/#")
                await client.subscribe("unisadiem/smartshirt/#")
                async for message in client.messages:
                    topic = str(message.topic)
                    try:
                        raw_payload = message.payload.decode().strip()
                        try:
                            payload = json.loads(raw_payload)
                        except json.JSONDecodeError:
                            # Try parsing as raw float if it's a number but not valid JSON
                            try:
                                payload = float(raw_payload)
                            except ValueError:
                                payload = raw_payload
                        await process_message(topic, payload)
                    except Exception as e:
                        print(f"Error processing MQTT message on topic {topic}: {e}")
                        traceback.print_exc()
        except Exception as e:
            print(f"MQTT Connection error: {e}. Retrying in 5 seconds...")
            await asyncio.sleep(5)

async def send_push_notification(db: AsyncSession, neonate: models.NeonateModel, alert_msg: str, severity: str = "critical"):
    """
    Gestisce l'invio delle notifiche di allarme.
    Invia l'avviso via Telegram (metodo primario e attivo) e tenta l'invio push remoto
    tramite Expo (canale legacy / non più utilizzato a seguito dell'uso dei WebSocket locali).
    """
    import requests
    from sqlalchemy import select
    try:
        # Invia la notifica via Telegram (Attiva)
        try:
            await telegram_bot.notify_users_via_telegram(db, neonate, alert_msg, severity)
        except Exception as te:
            print(f"[TELEGRAM ERROR] Errore invio notifica Telegram: {te}")

        # Fetch parent push tokens
        parent_query = select(models.UserModel.push_token).where(
            models.UserModel.id == neonate.parent_id,
            models.UserModel.push_token.isnot(None)
        )
        res = await db.execute(parent_query)
        parent_tokens = [row[0] for row in res.all() if row[0]]

        # Fetch doctor push tokens
        doctor_query = select(models.UserModel.push_token).where(
            models.UserModel.id == neonate.doctor_id,
            models.UserModel.push_token.isnot(None)
        )
        res_doc = await db.execute(doctor_query)
        doctor_tokens = [row[0] for row in res_doc.all() if row[0]]

        tokens = list(set(parent_tokens + doctor_tokens))
        if not tokens:
            print(f"[PUSH] No registered push tokens for neonate {neonate.first_name}")
            return

        messages = []
        for token in tokens:
            if token.startswith("ExponentPushToken"):
                messages.append({
                    "to": token,
                    "sound": "default",
                    "title": f"BabyGuard Alert: {neonate.first_name} {neonate.last_name}",
                    "body": alert_msg,
                    "data": {
                        "screen": "home",
                        "neonate_id": neonate.id
                    }
                })

        if not messages:
            return

        loop = asyncio.get_event_loop()
        def do_post():
            try:
                response = requests.post(
                    "https://exp.host/--/api/v2/push/send",
                    json=messages,
                    headers={
                        "Content-Type": "application/json"
                    }
                )
                print(f"[PUSH SUCCESS] Sent {len(messages)} push notifications. Response: {response.json()}")
            except Exception as e:
                print(f"[PUSH ERROR] Failed to send push notifications: {e}")

        await loop.run_in_executor(None, do_post)
    except Exception as e:
        print(f"[PUSH ERROR] Exception in send_push_notification: {e}")

async def check_apnea_conditions(db: AsyncSession, neonate: models.NeonateModel, state: DeviceState, device_id: str):
    now = time.time()
    dt = now - state.last_breath_time

    grave_threshold = 20

    alert_type = None
    alert_msg = ""
    severity = "critical"

    if dt >= grave_threshold:
        alert_type = "SIDS"
        alert_msg = f"🚨 ALLARME APNEA GRAVE (SIDS)\n\nAssenza di respirazione rilevata da oltre {grave_threshold}s ({int(dt)}s). Stimolare immediatamente il neonato!"
        severity = "critical"
    elif dt >= 10:
        # Check for bradycardia (EMA of HR < 100) or hypotonia (variance < 8000)
        has_bradycardia = state.latest_hr_ema is not None and state.latest_hr_ema < 100
        has_hypotonia = state.latest_var_acc is not None and state.latest_var_acc < 8000

        # Fallback to latest_hr if EMA not populated
        if state.latest_hr_ema is None and state.latest_hr is not None and state.latest_hr < 100:
            has_bradycardia = True

        if has_bradycardia or has_hypotonia:
            alert_type = "ALTE"
            reasons = []
            if has_bradycardia:
                hr_val = state.latest_hr_ema if state.latest_hr_ema is not None else state.latest_hr
                reasons.append(f"bradicardia (Battito: {hr_val:.1f} BPM)")
            if has_hypotonia:
                reasons.append(f"ipotonia (tono muscolare ridotto)")
            alert_msg = f"🚨 EMERGENZA CLINICA ALTE\n\nApnea sintomatica ({int(dt)}s) accompagnata da:\n" + "\n".join([f"• {r}" for r in reasons]) + "\n\nIntervenire immediatamente!"
            severity = "critical"

    if alert_type:
        # Rate limiting logic:
        # - Send if no alert sent in last 30s
        # - OR if upgrading from "ALTE" to "SIDS"
        last_apnea_type = getattr(state, "last_apnea_alert_type", None)
        last_apnea_time = getattr(state, "last_apnea_alert_time", 0)

        should_send = False
        if now - last_apnea_time > 30:
            should_send = True
        elif alert_type == "SIDS" and last_apnea_type == "Apnea":
            should_send = True

        if should_send:
            state.last_apnea_alert_type = alert_type
            state.last_apnea_alert_time = now

            db_alert = await crud.create_alert(db, neonate.id, alert_type, alert_msg, severity)
            print(f"[ALERT APNEA/SIDS] {neonate.first_name}: {alert_msg}")

            alert_message = {
                "event": "alert",
                "neonate_id": neonate.id,
                "device_id": device_id,
                "alert": {
                    "id": db_alert.id,
                    "type": db_alert.type,
                    "message": db_alert.message,
                    "severity": db_alert.severity,
                    "timestamp": db_alert.timestamp.isoformat() if db_alert.timestamp else None,
                    "is_resolved": bool(db_alert.is_resolved)
                }
            }

            await send_push_notification(db, neonate, alert_msg)

            if manager:
                await manager.broadcast(alert_message)
            if sse_queue:
                await sse_queue.put(alert_message)


async def apnea_monitor_loop():
    while True:
        await asyncio.sleep(2)
        try:
            async with database.AsyncSessionLocal() as db:
                from sqlalchemy import select
                # Fetch all neonates with an associated device
                result = await db.execute(select(models.NeonateModel).where(models.NeonateModel.device_id.isnot(None)))
                neonates = result.scalars().all()
                
                for neonate in neonates:
                    device_id = neonate.device_id
                    
                    # 1. Query InfluxDB for the latest values
                    latest_vitals = influx_manager.get_latest_vitals(device_id)
                    if not latest_vitals:
                        continue # No recent data in InfluxDB
                        
                    # 2. Get or create state
                    if device_id not in device_states:
                        device_states[device_id] = DeviceState(device_id)
                    state = device_states[device_id]
                    
                    # Heartbeat / Offline detection logic
                    if not hasattr(state, "is_online"):
                        state.is_online = True
                    if not hasattr(state, "last_offline_alert_time"):
                        state.last_offline_alert_time = 0
                        
                    timestamps = [v[1] for v in latest_vitals.values() if isinstance(v, tuple) and len(v) > 1]
                    latest_packet_ts = max(timestamps) if timestamps else None
                    now = time.time()
                    
                    if latest_packet_ts and (now - latest_packet_ts > 10):
                        # Il dispositivo è offline (nessun dato ricevuto da oltre 10 secondi)
                        if state.is_online:
                            state.is_online = False
                            if now - state.last_offline_alert_time > 30:
                                state.last_offline_alert_time = now
                                alert_type = "Connection"
                                alert_msg = f"🔌 DISPOSITIVO OFFLINE: La maglietta intelligente di {neonate.first_name} {neonate.last_name} si è disconnessa o spenta."
                                severity = "medium"
                                
                                db_alert = await crud.create_alert(db, neonate.id, alert_type, alert_msg, severity)
                                print(f"[ALERT CONNECTION] {neonate.first_name} Offline: {alert_msg}")
                                
                                alert_message = {
                                    "event": "alert",
                                    "neonate_id": neonate.id,
                                    "device_id": device_id,
                                    "alert": {
                                        "id": db_alert.id,
                                        "type": db_alert.type,
                                        "message": db_alert.message,
                                        "severity": db_alert.severity,
                                        "timestamp": db_alert.timestamp.isoformat() if db_alert.timestamp else None,
                                        "is_resolved": bool(db_alert.is_resolved)
                                    }
                                }
                                await send_push_notification(db, neonate, alert_msg, severity)
                                if manager:
                                    await manager.broadcast(alert_message)
                                if sse_queue:
                                    await sse_queue.put(alert_message)
                        continue  # Salta il calcolo delle apnee e delle soglie per evitare falsi positivi
                    else:
                        # Il dispositivo è online
                        if not state.is_online:
                            state.is_online = True
                            print(f"[CONNECTION] {neonate.first_name} tornato ONLINE.")
                            # Risolve automaticamente l'allarme di disconnessione precedente se presente
                            alert_message = {
                                "event": "alert_resolved",
                                "neonate_id": neonate.id,
                                "device_id": device_id,
                                "type": "Connection"
                            }
                            if manager:
                                await manager.broadcast(alert_message)
                    
                    # 3. Update state from InfluxDB instead of MQTT!
                    # Get temperature
                    temp_data = latest_vitals.get("temperature")
                    temp_val = temp_data[0] if temp_data else None
                    
                    # Get orientation
                    orientation_data = latest_vitals.get("orientation")
                    orientation = orientation_data[0] if orientation_data else None
                    
                    # Get breathrate
                    br_data = latest_vitals.get("breathrate")
                    br_val = br_data[0] if br_data else None
                    
                    # Battery info
                    soc = influx_manager.get_latest_battery_soc(device_id)
                    
                    # Last breath timestamp (breathrate > 0)
                    last_breath_ts = influx_manager.get_last_breath_time(device_id)
                    if last_breath_ts > 0:
                        state.last_breath_time = last_breath_ts
                        
                    # Heart rates
                    hrs = influx_manager.get_latest_heartrates(device_id, limit=5)
                    if hrs:
                        state.latest_hr = hrs[-1]
                        # Compute EMA
                        alpha = 0.2
                        state.latest_hr_ema = hrs[0]
                        for hr in hrs[1:]:
                            state.latest_hr_ema = alpha * hr + (1 - alpha) * state.latest_hr_ema
                            
                    # Accelerometer variance (hypotonia)
                    state.latest_var_acc = influx_manager.get_latest_acc_variance(device_id)

                    # Calcolo PCA live (una volta per ciclo), usata da apnea e bradicardia
                    pca_weeks = get_neonate_pca(neonate)

                    # 4. Check clinical apnea & ALTE conditions
                    #    (apnea ora e' eta'-dipendente internamente via PCA)
                    now = time.time()
                    dt = now - state.last_breath_time
                    
                    await check_apnea_conditions(db, neonate, state, device_id)
                    
                    # 5. Check position with persistence filter (Tp = 10s)
                    await check_position_persistence(db, neonate, state, device_id, orientation)

                    # 5b. Rilevamento caduta (impatto + immobilita')
                    acc_window = influx_manager.get_acc_window(device_id)
                    await check_fall_detection(db, neonate, state, device_id, acc_window)

                    # 5c. Bradicardia extreme-event PCA-dipendente (ALTE Q8)
                    await check_bradycardia_extreme(db, neonate, state, device_id, pca_weeks)

                    # 5d. Respiro periodico
                    breath_gaps = influx_manager.get_breath_gaps(device_id)
                    await check_periodic_breathing(db, neonate, state, device_id, breath_gaps)
                    
                    # 6. Check temperature & other thresholds
                    thresholds = await crud.get_thresholds(db, neonate.id)
                    if thresholds:
                        await check_temperature_trend(db, neonate, state, device_id, temp_val, thresholds)
                        await perform_threshold_checks(db, neonate, state, device_id, temp_val, br_val, orientation, soc, thresholds)
                        
        except Exception as e:
            print(f"Error in apnea_monitor_loop: {e}")
            traceback.print_exc()
