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
    """
    Parses the log file, grouping messages by their relative timestamp.
    """
    if not os.path.exists(file_path):
        print(f"Errore: File dei messaggi non trovato in {file_path}")
        sys.exit(1)

    print(f"Caricamento dei messaggi da: {file_path}")
    grouped_messages = {}
    
    with open(file_path, "r", encoding="utf-8") as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line or not line.startswith("unisadiem/"):
                continue
            
            try:
                # Format: <topic> <payload>
                parts = line.split(" ", 1)
                if len(parts) != 2:
                    continue
                
                topic, payload_str = parts
                payload = json.loads(payload_str)
                
                # Extract relative timestamp (default to 0 if not found)
                rel_ts = payload.get("timestamp", 0)
                
                if rel_ts not in grouped_messages:
                    grouped_messages[rel_ts] = []
                
                grouped_messages[rel_ts].append((topic, payload))
            except Exception as e:
                print(f"Errore di parsing alla riga {line_num}: {e}")
                
    # Sort by relative timestamp
    sorted_timestamps = sorted(grouped_messages.keys())
    ordered_groups = [grouped_messages[ts] for ts in sorted_timestamps]
    
    print(f"Caricati con successo {sum(len(g) for g in ordered_groups)} messaggi divisi in {len(ordered_groups)} secondi di dati.")
    return ordered_groups

def generate_dynamic_payload(topic, payload, device_index, device_id):
    """
    Overrides static payloads with dynamically generated mathematical waves.
    Varies calculations based on device_index to show distinct values per shirt.
    """
    parts = topic.split("/")
    if len(parts) < 4:
        return payload
    
    message_type = parts[3]
    now_t = time.time()

    # Cycle orientation dynamically every 15 seconds to let user verify UI updates:
    # 32=pancia in su (Supina)
    # 2=fianco destro
    # 1=fianco sinistro
    # 16=pancia in giù (Prona) -> will trigger alert
    # 0=transizione
    # Total cycle is 65 seconds
    t_cycle = int(now_t) % 65
    if t_cycle < 15:
        orient_val = 32  # Supina
    elif t_cycle < 30:
        orient_val = 2   # Fianco Dx
    elif t_cycle < 45:
        orient_val = 1   # Fianco Sx
    elif t_cycle < 60:
        orient_val = 16  # Prona
    else:
        orient_val = 0   # Transizione
    
    # 1. ECG (128 Hz wave + dynamic heartrate)
    if message_type == "ECG":
        # Slow baseline respiration drift (0.2 Hz) - phase shifted per device
        resp_drift = 40000.0 * math.sin(2 * math.pi * 0.2 * now_t + device_index)
        
        # Distinct heart rates per device: (e.g. 98, 113, 128 BPM)
        hr_bpm = int((95 + device_index * 15) + 6 * math.sin(2 * math.pi * 0.005 * now_t))
        hr_freq = hr_bpm / 60.0 # Hz
        
        samples = []
        for i in range(128):
            t = now_t + (i / 128.0)
            phase = (t * hr_freq) % 1.0
            
            # Simple synthetic ECG pulse (P-QRS-T) approximation
            qrs = 0.0
            if phase < 0.08:
                # P wave
                qrs = 30000.0 * math.sin(math.pi * phase / 0.08)
            elif phase < 0.12:
                # Q wave
                qrs = -20000.0 * math.sin(math.pi * (phase - 0.08) / 0.04)
            elif phase < 0.16:
                # R spike
                qrs = 500000.0 * math.sin(math.pi * (phase - 0.12) / 0.04)
            elif phase < 0.20:
                # S wave
                qrs = -80000.0 * math.sin(math.pi * (phase - 0.16) / 0.04)
            elif phase < 0.35:
                # T wave
                qrs = 90000.0 * math.sin(math.pi * (phase - 0.20) / 0.15)
                
            val = 1450000.0 + resp_drift + qrs + random.uniform(-4000, 4000)
            samples.append(val)
            
        payload["samples"] = samples
        payload["frequency"] = 128
        payload["heartrate"] = hr_bpm
        payload["status"] = 1 # OK

    # 2. STRAINGAUGES_MIXED (Breathing wave at 13 Hz + breathrate)
    elif message_type == "STRAINGAUGES_MIXED":
        # Distinct respiratory patterns per device: (e.g. 21, 26, 31 breaths/min)
        br_bpm = int((20 + device_index * 5) + 3 * math.sin(2 * math.pi * 0.007 * now_t))
        br_freq = br_bpm / 60.0 # Hz
        
        s1, s2, s3 = [], [], []
        period = 0.075 # 75 ms
        for i in range(13):
            t = now_t + (i * period)
            # Sinuous breathing wave
            breath = 90000.0 * math.sin(2 * math.pi * br_freq * t + device_index)
            
            s1.append(2095000.0 + breath + random.uniform(-200, 200))
            s2.append(2587000.0 + 1.1 * breath + random.uniform(-200, 200))
            s3.append(random.uniform(-20, 20))
            
        payload["samples_1"] = s1
        payload["samples_2"] = s2
        payload["samples_3"] = s3
        payload["breathrate"] = br_bpm
        payload["sample_period_press"] = 75

    # 3. ACC_GYRO (Accelerometer x, y, z wave at 3 Hz)
    elif message_type == "ACC_GYRO":
        s = []
        for i in range(16):
            t = now_t + (i / 16.0)
            # Add dynamic shaking/breathing chest movements
            x = int(-4000 + 400 * math.sin(2 * math.pi * 0.15 * t + device_index))
            y = int(-10000 + 300 * math.sin(2 * math.pi * 0.18 * t + device_index))
            z = int(12000 + 500 * math.sin(2 * math.pi * 0.12 * t + device_index))
            s.append({"x": x, "y": y, "z": z})
        payload["samples"] = s
        payload["sampling_frequency"] = 3
        payload["orientation"] = orient_val

    # 4. TEMPERATURE (Body temperature drift: 36.4 - 36.9 °C)
    elif message_type == "TEMPERATURE":
        temp_val = int((3650 + device_index * 20) + 15 * math.sin(2 * math.pi * 0.003 * now_t))
        payload["temperature"] = temp_val

    # 5. BATTERY_INFO (Battery SoC slow drift or decay)
    elif message_type == "BATTERY_INFO":
        soc = int((88 - device_index * 8) + 4 * math.sin(2 * math.pi * 0.001 * now_t))
        payload["state_of_charge"] = max(0, min(100, soc))
        payload["voltage"] = 3700 + soc * 4
        payload["charging"] = 0
        
    # 6. BABY_ORIENTATION
    elif message_type == "BABY_ORIENTATION":
        payload["orientation"] = orient_val
        
    return payload

def main():
    parser = argparse.ArgumentParser(description="Simulatore Multi-Maglietta Dinamico per BabyGuard")
    parser.add_argument("--broker", default=DEFAULT_BROKER, help="IP o hostname del broker MQTT")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Porta del broker MQTT")
    parser.add_argument("--file", default=DEFAULT_FILE, help="File dei messaggi di esempio")
    parser.add_argument("--devices", default=",".join(DEFAULT_DEVICES), help="Lista di device_id separati da virgola (es. tshirt001,tshirt002)")
    parser.add_argument("--loop", action="store_true", default=True, help="Ripeti continuamente la simulazione")
    parser.add_argument("--interval", type=float, default=1.0, help="Intervallo di invio tra i secondi simulati (default: 1.0s)")
    
    args = parser.parse_args()
    
    devices = [d.strip() for d in args.devices.split(",") if d.strip()]
    print(f"Dispositivi simulati: {devices}")
    
    # Parse the log messages
    message_groups = parse_messages(args.file)
    
    if not message_groups:
        print("Nessun messaggio valido trovato nel file.")
        sys.exit(1)
        
    # Initialize MQTT client
    client = mqtt.Client(callback_api_version=mqtt.CallbackAPIVersion.VERSION2)
    
    print(f"Connessione al broker MQTT {args.broker}:{args.port}...")
    try:
        client.connect(args.broker, args.port, 60)
    except Exception as e:
        print(f"Impossibile connettersi al broker MQTT: {e}")
        print("Verifica che il container Docker 'mosquitto' sia avviato.")
        sys.exit(1)
        
    client.loop_start()
    
    cycle = 1
    try:
        while True:
            print(f"\n--- Inizio ciclo di simulazione multi-dispositivo #{cycle} ---")
            for sec_idx, group in enumerate(message_groups, 1):
                current_epoch = int(time.time())
                print(f"[Sim] Secondo {sec_idx}/{len(message_groups)} - Invio messaggi per {len(devices)} magliette...")
                
                for device_idx, device_id in enumerate(devices):
                    for orig_topic, orig_payload in group:
                        # Clona il payload originale per non corrompere gli altri cicli/dispositivi
                        payload = json.loads(json.dumps(orig_payload))
                        
                        # Genera il nuovo topic sostituendo il device_id originale
                        topic_parts = orig_topic.split("/")
                        if len(topic_parts) >= 3:
                            topic_parts[2] = device_id
                            topic = "/".join(topic_parts)
                        else:
                            topic = orig_topic
                        
                        # Genera dati dinamici specifici per questo dispositivo
                        payload = generate_dynamic_payload(topic, payload, device_idx, device_id)
                        
                        # Aggiorna il timestamp all'epoca corrente
                        payload["timestamp"] = current_epoch
                        
                        # Converti in stringa JSON
                        payload_str = json.dumps(payload)
                        
                        # Pubblica il dato
                        client.publish(topic, payload_str)
                        
                print(f"  -> Pubblicati i dati per: {devices}")
                time.sleep(args.interval)
                
            if not args.loop:
                break
            cycle += 1
            
    except KeyboardInterrupt:
        print("\nSimulazione arrestata dall'utente.")
    finally:
        client.loop_stop()
        client.disconnect()
        print("Mqtt disconnesso. Uscita.")

if __name__ == "__main__":
    main()
