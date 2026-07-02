import time
import json
import argparse
import sys
import os
import math
import random
import paho.mqtt.client as mqtt

# Default configuration
DEFAULT_BROKER = "localhost"
DEFAULT_PORT = 1883
DEFAULT_FILE = "esempio_messaggi_unisadiemsmartshirttshirt001.txt"
DEFAULT_DEVICES = ["tshirt001", "tshirt002", "tshirt003"]

def parse_messages(file_path):
    if not os.path.exists(file_path):
        print(f"Errore: File dei messaggi non trovato in {file_path}")
        sys.exit(1)
    grouped_messages = {}
    with open(file_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or not line.startswith("unisadiem/"):
                continue
            try:
                parts = line.split(" ", 1)
                if len(parts) != 2:
                    continue
                topic, payload_str = parts
                payload = json.loads(payload_str)
                rel_ts = payload.get("timestamp", 0)
                if rel_ts not in grouped_messages:
                    grouped_messages[rel_ts] = []
                grouped_messages[rel_ts].append((topic, payload))
            except Exception:
                pass
    sorted_timestamps = sorted(grouped_messages.keys())
    return [grouped_messages[ts] for ts in sorted_timestamps]

def generate_dynamic_payload(topic, payload, device_index, device_id):
    parts = topic.split("/")
    if len(parts) < 4:
        return payload
    
    message_type = parts[3]
    now_t = time.time()
    
    # 160-second cycle to rotate through different critical alarms without downtime
    t_cycle = int(now_t) % 160
    
    # Defaults
    orient_val = 32
    hr_bpm = 120
    br_bpm = 30
    temp_val = 36.6
    is_flat_acc = False
    
    # --- CONSTANT CRITICAL ALARMS LOOP ---
    # Phase 1: ALTE & Severe Apnea + Hypothermia (0s to 40s)
    # Simulates: Apnea (BR=0), Bradycardia (70 BPM), Hypotonia (variance=0), and Hypothermia (35.2°C)
    # Expected alerts: ALTE at 10s, SIDS Apnea at 20s, and Hypothermia
    if t_cycle < 40:
        orient_val = 32
        hr_bpm = 70
        br_bpm = 0
        temp_val = 35.2
        is_flat_acc = True
        
    # Phase 2: Recovery of vitals but remaining in Hypothermia (40s to 80s)
    # Simulates: Normal breathing/HR/ACC to clear apnea/ALTE, but Temp stays at 35.2°C
    # Expected alerts: Hypothermia (ALTE and SIDS Apnea will clear/resolve in UI)
    elif t_cycle < 80:
        orient_val = 32
        hr_bpm = 118
        br_bpm = 28
        temp_val = 35.2
        is_flat_acc = False
        
    # Phase 3: Prone Position SIDS + Heating Up (80s to 120s)
    # Simulates: Prone position (16) and Temp rising from 35.2°C to 39.8°C
    # Expected alerts: SIDS Position after 10s of persistence (at second 90) and Hyperthermia ramping up
    elif t_cycle < 120:
        orient_val = 16   # Prona (a rischio SIDS)
        hr_bpm = 120
        br_bpm = 32
        is_flat_acc = False
        # Temp rising from 35.2 to 39.8
        elapsed = t_cycle - 80
        temp_val = 35.2 + (39.8 - 35.2) * (elapsed / 40.0)
        
    # Phase 4: High Fever / Hyperthermia Peak (120s to 160s)
    # Simulates: Temp stays high at 39.8°C, orientation returns to safe supine (32)
    # Expected alerts: Hyperthermia (SIDS Position alert clears in UI)
    else:
        orient_val = 32
        hr_bpm = 122
        br_bpm = 30
        temp_val = 39.8
        is_flat_acc = False
        
    # ECG
    if message_type == "ECG":
        resp_drift = 40000.0 * math.sin(2 * math.pi * 0.2 * now_t + device_index)
        hr_freq = hr_bpm / 60.0
        samples = []
        for i in range(128):
            t = now_t + (i / 128.0)
            phase = (t * hr_freq) % 1.0
            qrs = 0.0
            if phase < 0.08:
                qrs = 30000.0 * math.sin(math.pi * phase / 0.08)
            elif phase < 0.12:
                qrs = -20000.0 * math.sin(math.pi * (phase - 0.08) / 0.04)
            elif phase < 0.16:
                qrs = 500000.0 * math.sin(math.pi * (phase - 0.12) / 0.04)
            elif phase < 0.20:
                qrs = -80000.0 * math.sin(math.pi * (phase - 0.16) / 0.04)
            elif phase < 0.35:
                qrs = 90000.0 * math.sin(math.pi * (phase - 0.20) / 0.15)
            val = 1450000.0 + resp_drift + qrs + random.uniform(-3000, 3000)
            samples.append(val)
            
        payload["samples"] = samples
        payload["frequency"] = 128
        payload["heartrate"] = hr_bpm
        payload["status"] = 1

    # 2. STRAINGAUGES_MIXED
    elif message_type == "STRAINGAUGES_MIXED":
        s1, s2, s3 = [], [], []
        period = 0.075
        br_freq = br_bpm / 60.0 if br_bpm > 0 else 0
        for i in range(13):
            t = now_t + (i * period)
            if br_bpm > 0:
                breath = 90000.0 * math.sin(2 * math.pi * br_freq * t + device_index)
            else:
                breath = 0.0
            s1.append(2095000.0 + breath + random.uniform(-10, 10))
            s2.append(2587000.0 + 1.1 * breath + random.uniform(-10, 10))
            s3.append(random.uniform(-5, 5))
            
        payload["samples_1"] = s1
        payload["samples_2"] = s2
        payload["samples_3"] = s3
        payload["breathrate"] = br_bpm
        payload["sample_period_press"] = 75

    # 3. ACC_GYRO
    elif message_type == "ACC_GYRO":
        s = []
        for i in range(16):
            t = now_t + (i / 16.0)
            if is_flat_acc:
                x, y, z = -4000, -10000, 12000
            else:
                x = int(-4000 + 400 * math.sin(2 * math.pi * 0.15 * t + device_index))
                y = int(-10000 + 300 * math.sin(2 * math.pi * 0.18 * t + device_index))
                z = int(12000 + 500 * math.sin(2 * math.pi * 0.12 * t + device_index))
            s.append({"x": x, "y": y, "z": z})
        payload["samples"] = s
        payload["sampling_frequency"] = 3
        payload["orientation"] = orient_val

    # 4. TEMPERATURE
    elif message_type in ("TEMPERATURE", "TemperatureNTC"):
        payload["temperature"] = round(temp_val, 2)
        payload["type"] = "temperature"

    # 5. BATTERY_INFO
    elif message_type == "BATTERY_INFO":
        payload["state_of_charge"] = 90
        payload["voltage"] = 4100
        payload["charging"] = 0
        
    # 6. BABY_ORIENTATION
    elif message_type == "BABY_ORIENTATION":
        payload["orientation"] = orient_val
        
    # Inject status description for dynamic real-time logs
    if t_cycle < 40:
        payload["status_desc"] = "Apnea + Bradicardia + Ipotonia (ALTE!) | Ipotermia"
    elif t_cycle < 80:
        payload["status_desc"] = "Ipotermia (Recupero Respiro/Battito)"
    elif t_cycle < 120:
        payload["status_desc"] = "Posizione Prona [Rischio SIDS] | Trend Riscaldamento"
    else:
        payload["status_desc"] = "Ipertermia (Febbre Alta!)"

    return payload

def main():
    parser = argparse.ArgumentParser(description="Simulatore Casi Critici per BabyGuard")
    parser.add_argument("--broker", default=DEFAULT_BROKER, help="IP o hostname del broker MQTT")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Porta del broker MQTT")
    parser.add_argument("--file", default=DEFAULT_FILE, help="File dei messaggi di esempio")
    parser.add_argument("--devices", default=",".join(DEFAULT_DEVICES), help="Dispositivi")
    args = parser.parse_args()
    
    devices = [d.strip() for d in args.devices.split(",") if d.strip()]
    print(f"Simulazione CASI CRITICI per dispositivi: {devices}")
    
    message_groups = parse_messages(args.file)
    if not message_groups:
        sys.exit(1)
        
    client = mqtt.Client(callback_api_version=mqtt.CallbackAPIVersion.VERSION2)
    client.connect(args.broker, args.port, 60)
    client.loop_start()
    
    try:
        while True:
            for sec_idx, group in enumerate(message_groups, 1):
                current_epoch = int(time.time())
                print(f"\n[Sim] Secondo {sec_idx}/{len(message_groups)} - Timestamp: {current_epoch}")
                for device_idx, device_id in enumerate(devices):
                    vitals = {"HR": "-", "BR": "-", "Temp": "-", "Orient": "-", "Status": "Normale"}
                    for orig_topic, orig_payload in group:
                        payload = json.loads(json.dumps(orig_payload))
                        topic_parts = orig_topic.split("/")
                        if len(topic_parts) >= 3:
                            topic_parts[2] = device_id
                            if len(topic_parts) >= 4 and topic_parts[3] == "TEMPERATURE":
                                topic_parts[3] = "TemperatureNTC"
                            topic = "/".join(topic_parts)
                        else:
                            topic = orig_topic
                        
                        payload = generate_dynamic_payload(topic, payload, device_idx, device_id)
                        
                        # Estrai valori per la stampa
                        if len(topic_parts) >= 4:
                            m_type = topic_parts[3]
                            if m_type == "ECG":
                                vitals["HR"] = f"{payload.get('heartrate')} BPM"
                            elif m_type == "STRAINGAUGES_MIXED":
                                br = payload.get('breathrate')
                                vitals["BR"] = f"{br}/min" if br > 0 else "0/min (APNEA!)"
                            elif m_type in ("TEMPERATURE", "TemperatureNTC"):
                                vitals["Temp"] = f"{payload.get('temperature')}°C"
                            elif m_type == "ACC_GYRO":
                                orient = payload.get('orientation')
                                if orient == 32:
                                    vitals["Orient"] = "Supina (32)"
                                elif orient == 16:
                                    vitals["Orient"] = "Prona (16) [Rischio SIDS]"
                                else:
                                    vitals["Orient"] = f"{orient}"
                        
                        # Recupera la descrizione clinica della fase di allarme
                        status_desc = payload.get("status_desc")
                        if status_desc:
                            vitals["Status"] = status_desc
                        
                        payload["timestamp"] = current_epoch
                        client.publish(topic, json.dumps(payload))
                    
                    # Stampa log riepilogativo per la maglietta
                    print(f"  -> [{device_id}] HR: {vitals['HR']} | BR: {vitals['BR']} | Temp: {vitals['Temp']} | Orientamento: {vitals['Orient']} | Stato: {vitals['Status']}")
                time.sleep(1.0)
    except KeyboardInterrupt:
        pass
    finally:
        client.loop_stop()
        client.disconnect()

if __name__ == "__main__":
    main()
