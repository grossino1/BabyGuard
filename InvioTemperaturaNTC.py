import network
import time
import math
from machine import Pin, ADC
from umqtt.simple import MQTTClient

# --- Parametri Wi-Fi e MQTT ---
WIFI_SSID = 'OpenWrt' # "GiacomoWIFI" 
WIFI_PASS = 'academy2026' # "forzaroma1927@"
MQTT_BROKER = "192.168.2.55" # "172.20.10.2"
MQTT_CLIENT_ID = 'ESP32_Giacomo_NTC'

# --- Topic MQTT (Solo Invio) ---
MQTT_TOPIC_NTC1 = b'unisadiem/smartshirt/tshirt001/TemperatureNTC'
MQTT_TOPIC_NTC2 = b'unisadiem/smartshirt/tshirt002/TemperatureNTC'

# --- Parametri NTC (Termistore) ---
BETA = 3950           # Parametro Beta dell'NTC
R_SERIES = 10000.0    # Resistenza fissa in serie (10k Ohm)
T_NOMINAL = 298.15    # Temperatura nominale in Kelvin (25°C)
R_NOMINAL = 10000.0   # Resistenza NTC a 25°C (10k Ohm)

# --- Configurazione Wi-Fi ---
station = network.WLAN(network.STA_IF)
station.active(True)
station.disconnect()
time.sleep(1)

# --- Configurazione ADC NTC (Pin 32 e 33) ---
adc1 = ADC(Pin(32))
adc1.atten(ADC.ATTN_11DB)   # Range fino a 3.3V
adc1.width(ADC.WIDTH_12BIT) # Risoluzione 0-4095

adc2 = ADC(Pin(33))
adc2.atten(ADC.ATTN_11DB)
adc2.width(ADC.WIDTH_12BIT)

# --- Funzioni Ausiliarie ---
def read_ntc_temp(adc):
    """Legge l'ADC, calcola la temperatura e applica filtri hardware e logici."""
    try:
        analog_val = adc.read()
        
        # 1. Filtro di Sicurezza: Evita errori matematici in caso di pin volante estremo o corto circuito
        if analog_val > 4000 or analog_val < 100:
            return None

        # Calcolo Steinhart-Hart
        r_ntc = R_SERIES * (analog_val / (4095.0 - analog_val))
        steinhart = r_ntc / R_NOMINAL
        steinhart = math.log(steinhart)
        steinhart /= BETA
        steinhart += 1.0 / T_NOMINAL
        steinhart = 1.0 / steinhart
        temp_c = steinhart - 273.15 
        
        # 2. FILTRO LOGICO: Taglia fuori il rumore a radiofrequenza (i famosi 99°C o temperature negative)
        # Una "smart shirt" starà ragionevolmente tra 0°C e 60°C.
        if temp_c < 0 or temp_c > 60:
            return None
            
        return round(temp_c, 2)
    except Exception:
        # Nasconde errori imprevisti di calcolo restituendo "Nessun Sensore"
        return None

def connect_wifi():
    if not station.isconnected():
        print(f"Connessione a {WIFI_SSID} in corso...")
        station.connect(WIFI_SSID, WIFI_PASS)
        
        timeout = 15
        while not station.isconnected() and timeout > 0:
            print(".", end="")
            time.sleep(1)
            timeout -= 1
            
        print("")
        
        if station.isconnected():
            print(f"Connessione Wi-Fi stabilita! IP: {station.ifconfig()[0]}")
        else:
            print("Errore: Timeout connessione Wi-Fi.")

# --- Main Setup ---
connect_wifi()
client = None

if station.isconnected():
    try:
        client = MQTTClient(MQTT_CLIENT_ID, MQTT_BROKER)
        client.connect()
        print(f"Connesso al Broker MQTT ({MQTT_BROKER})! Inizio lettura sensori...")
    except Exception as e:
        print("Errore configurazione MQTT:", e)       
else:
    print("Avvio interrotto: Nessuna connessione Wi-Fi.")

# --- Main Loop ---
while True:
    if client:
        try:
            # Lettura Sensore 1
            temp1 = read_ntc_temp(adc1)
            if temp1 is not None:
                print(f"NTC 1: {temp1} °C - Invio...")
                client.publish(MQTT_TOPIC_NTC1, str(temp1).encode())
            
            # Lettura Sensore 2
            temp2 = read_ntc_temp(adc2)
            if temp2 is not None:
                print(f"NTC 2: {temp2} °C - Invio...")
                client.publish(MQTT_TOPIC_NTC2, str(temp2).encode())
                
            time.sleep(1)

        except OSError:
            print("Connessione MQTT persa. Tento la riconnessione...")
            try:
                connect_wifi()
                if station.isconnected():
                    client.connect()
                    print("Riconnesso al Broker!")
            except Exception as e:
                print("Riconnessione fallita:", e)
            time.sleep(2)