import asyncio
import json
import time
import math
import urllib.request
import aiomqtt
from sqlalchemy.ext.asyncio import AsyncSession
from . import models, database, crud
from .influx_manager import influx_manager

MQTT_BROKER = "mosquitto" # Name of the service in docker-compose
MQTT_PORT = 1883
TOPIC_PREFIX = "unisadiem/dmcs/sensor"

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

    # 1. Temperature Check
    if temp_val is not None and temp_val > 0:
        if temp_val < thresholds.temp_min:
            await trigger_threshold_alert("Temp", f"Temperatura bassa: {temp_val}°C", "high")
        elif temp_val > thresholds.temp_max:
            await trigger_threshold_alert("Temp", f"Temperatura alta: {temp_val}°C", "high")

    # 2. Heart Rate Check
    if state.latest_hr is not None and state.latest_hr > 0:
        if state.latest_hr < thresholds.hr_min:
            await trigger_threshold_alert("HR", f"Bradicardia rilevata: {state.latest_hr} BPM", "critical")
        elif state.latest_hr > thresholds.hr_max:
            await trigger_threshold_alert("HR", f"Tachicardia rilevata: {state.latest_hr} BPM", "high")

    # 3. Breath Rate Check
    if br_val is not None and br_val > 0:
        if br_val < thresholds.br_min:
            await trigger_threshold_alert("BR", f"Respiro debole: {br_val} atti/min", "critical")
        elif br_val > thresholds.br_max:
            await trigger_threshold_alert("BR", f"Iperventilazione: {br_val} atti/min", "high")

    # 4. Position Check
    if orientation == 1:
        await trigger_threshold_alert("Position", "Posizione PRONA rilevata! Rischio SIDS.", "critical")

    # 5. Battery Check
    if soc is not None and soc <= 15:
        await trigger_threshold_alert("Battery", f"Batteria scarica: {soc}%", "high")

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
                        payload = json.loads(message.payload.decode())
                        await process_message(topic, payload)
                    except Exception as e:
                        print(f"Error processing MQTT message: {e}")
        except Exception as e:
            print(f"MQTT Connection error: {e}. Retrying in 5 seconds...")
            await asyncio.sleep(5)

async def send_push_notification(db: AsyncSession, neonate: models.NeonateModel, alert_msg: str):
    import requests
    from sqlalchemy import select
    try:
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
    
    alert_type = None
    alert_msg = ""
    severity = "critical"
    
    if dt >= 20:
        alert_type = "SIDS"
        alert_msg = f"Apnea prolungata rilevata ({int(dt)}s)! Sospetta SIDS."
        severity = "critical"
    elif dt >= 10:
        # Check for bradycardia (EMA of HR < 100) or hypotonia (variance < 8000)
        has_bradycardia = state.latest_hr_ema is not None and state.latest_hr_ema < 100
        has_hypotonia = state.latest_var_acc is not None and state.latest_var_acc < 8000
        
        # Fallback to latest_hr if EMA not populated
        if state.latest_hr_ema is None and state.latest_hr is not None and state.latest_hr < 100:
            has_bradycardia = True
            
        if has_bradycardia or has_hypotonia:
            alert_type = "Apnea"
            reasons = []
            if has_bradycardia:
                hr_val = state.latest_hr_ema if state.latest_hr_ema is not None else state.latest_hr
                reasons.append(f"bradicardia (HR EMA: {hr_val:.1f} BPM)")
            if has_hypotonia:
                reasons.append(f"ipotonia (var: {state.latest_var_acc:.1f})")
            alert_msg = f"Apnea sintomatica rilevata ({int(dt)}s) con " + " e ".join(reasons)
            severity = "critical"
            
    if alert_type:
        # Rate limiting logic:
        # - Send if no alert sent in last 30s
        # - OR if upgrading from "Apnea" to "SIDS"
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
            
            # Send remote push notifications!
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
                    
                    # 4. Check clinical apnea conditions
                    await check_apnea_conditions(db, neonate, state, device_id)
                    
                    # 5. Check thresholds
                    thresholds = await crud.get_thresholds(db, neonate.id)
                    if thresholds:
                        await perform_threshold_checks(db, neonate, state, device_id, temp_val, br_val, orientation, soc, thresholds)
                        
        except Exception as e:
            print(f"Error in apnea_monitor_loop: {e}")
