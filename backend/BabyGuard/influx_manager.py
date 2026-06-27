import os
from influxdb_client import InfluxDBClient
from datetime import datetime

INFLUXDB_URL = os.getenv("INFLUXDB_URL", "http://influxdb:8086")
INFLUXDB_TOKEN = os.getenv("INFLUXDB_TOKEN", "r0LEEIw1jw71txRTUPLKkwf0Ye1ohBE_cvUN26LptwKHEYuNaABxxIXeSY7SlreKdPWLzhiTGRrV3Xi7HLYwmg==")
INFLUXDB_ORG = os.getenv("INFLUXDB_ORG", "lab_org")
INFLUXDB_BUCKET = os.getenv("INFLUXDB_BUCKET", "babyguard_bucket")

class InfluxManager:
    def __init__(self):
        self.url = INFLUXDB_URL
        self.token = INFLUXDB_TOKEN
        self.org = INFLUXDB_ORG
        self.bucket = INFLUXDB_BUCKET

    def _get_client(self):
        return InfluxDBClient(url=self.url, token=self.token, org=self.org)

    def query_historical_field(self, device_id: str, field_name: str, range_start: str = "-2h", aggregate_window: str = None) -> list:
        """
        Query InfluxDB for a specific field of a device over a given range start (e.g. '-2h', '-24h').
        Optionally aggregates the data over an aggregate window (e.g. '1m', '5m').
        """
        client = self._get_client()
        query_api = client.query_api()

        query = f'from(bucket: "{self.bucket}")\n'
        query += f'  |> range(start: {range_start})\n'
        query += f'  |> filter(fn: (r) => r["_measurement"] == "vitals_summary")\n'
        query += f'  |> filter(fn: (r) => r["shirt_id"] == "{device_id}")\n'
        query += f'  |> filter(fn: (r) => r["_field"] == "{field_name}")\n'
        
        if aggregate_window:
            query += f'  |> aggregateWindow(every: {aggregate_window}, fn: mean, createEmpty: false)\n'
        
        query += '  |> keep(columns: ["_time", "_value"])\n'

        try:
            result = query_api.query(org=self.org, query=query)
            data = []
            for table in result:
                for record in table.records:
                    data.append({
                        "time": record.get_time().isoformat() if isinstance(record.get_time(), datetime) else str(record.get_time()),
                        "value": record.get_value()
                    })
            return data
        except Exception as e:
            print(f"Error querying InfluxDB: {e}")
            return []
        finally:
            client.close()

    def get_average_metric(self, device_id: str, field_name: str, range_start: str = "-2h") -> float:
        """
        Calculates the average value of a specific metric over a time range.
        """
        client = self._get_client()
        query_api = client.query_api()

        query = f'from(bucket: "{self.bucket}")\n'
        query += f'  |> range(start: {range_start})\n'
        query += f'  |> filter(fn: (r) => r["_measurement"] == "vitals_summary")\n'
        query += f'  |> filter(fn: (r) => r["shirt_id"] == "{device_id}")\n'
        query += f'  |> filter(fn: (r) => r["_field"] == "{field_name}")\n'
        query += '  |> mean()\n'

        try:
            result = query_api.query(org=self.org, query=query)
            for table in result:
                for record in table.records:
                    return record.get_value()
            return 0.0
        except Exception as e:
            print(f"Error querying average metric: {e}")
            return 0.0
        finally:
            client.close()

    def get_active_monitoring_hours(self, device_id: str, range_start: str = "-24h") -> float:
        """
        Calculates the active monitoring duration (in hours) by counting the temperature samples.
        We assume 1 sample every 5 seconds (720 samples = 1 hour).
        """
        client = self._get_client()
        query_api = client.query_api()

        query = f'from(bucket: "{self.bucket}")\n'
        query += f'  |> range(start: {range_start})\n'
        query += f'  |> filter(fn: (r) => r["_measurement"] == "vitals_summary")\n'
        query += f'  |> filter(fn: (r) => r["shirt_id"] == "{device_id}")\n'
        query += f'  |> filter(fn: (r) => r["_field"] == "temperature")\n'
        query += '  |> count()\n'

        try:
            result = query_api.query(org=self.org, query=query)
            count = 0
            for table in result:
                for record in table.records:
                    val = record.get_value()
                    if val is not None:
                        count = val
            return count / 720.0
        except Exception as e:
            print(f"Error querying active monitoring hours: {e}")
            return 0.0
        finally:
            client.close()

    def get_latest_vitals(self, device_id: str) -> dict:
        """
        Retrieves the latest values for all vitals metrics of a device from InfluxDB.
        """
        client = self._get_client()
        query_api = client.query_api()

        query = f'from(bucket: "{self.bucket}")\n'
        query += f'  |> range(start: -1m)\n'
        query += f'  |> filter(fn: (r) => r["_measurement"] == "vitals_summary")\n'
        query += f'  |> filter(fn: (r) => r["shirt_id"] == "{device_id}")\n'
        query += f'  |> last()\n'

        try:
            result = query_api.query(org=self.org, query=query)
            vitals = {}
            for table in result:
                for record in table.records:
                    field = record.get_field()
                    val = record.get_value()
                    import time
                    time_val = record.get_time().timestamp() if hasattr(record.get_time(), "timestamp") else time.time()
                    vitals[field] = (val, time_val)
            return vitals
        except Exception as e:
            print(f"Error querying latest vitals: {e}")
            return {}
        finally:
            client.close()

    def get_last_breath_time(self, device_id: str) -> float:
        """
        Queries InfluxDB for the timestamp of the last recorded breath (where breathrate > 0).
        """
        client = self._get_client()
        query_api = client.query_api()

        query = f'from(bucket: "{self.bucket}")\n'
        query += f'  |> range(start: -24h)\n'
        query += f'  |> filter(fn: (r) => r["_measurement"] == "vitals_summary")\n'
        query += f'  |> filter(fn: (r) => r["shirt_id"] == "{device_id}")\n'
        query += f'  |> filter(fn: (r) => r["_field"] == "breathrate")\n'
        query += f'  |> filter(fn: (r) => r["_value"] > 0)\n'
        query += f'  |> last()\n'

        try:
            result = query_api.query(org=self.org, query=query)
            for table in result:
                for record in table.records:
                    t = record.get_time()
                    return t.timestamp()
            return 0.0
        except Exception as e:
            print(f"Error querying last breath time: {e}")
            return 0.0
        finally:
            client.close()

    def get_latest_heartrates(self, device_id: str, limit: int = 5) -> list:
        """
        Queries the last 'limit' heartrate values from InfluxDB (only if status == 1).
        """
        client = self._get_client()
        query_api = client.query_api()

        query = f'from(bucket: "{self.bucket}")\n'
        query += f'  |> range(start: -5m)\n'
        query += f'  |> filter(fn: (r) => r["_measurement"] == "vitals_summary")\n'
        query += f'  |> filter(fn: (r) => r["shirt_id"] == "{device_id}")\n'
        query += f'  |> filter(fn: (r) => r["_field"] == "heartrate" or r["_field"] == "status")\n'
        query += f'  |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")\n'
        query += f'  |> filter(fn: (r) => r["status"] == 1 or r["status"] == 1.0)\n'
        query += f'  |> tail(n: {limit})\n'

        try:
            result = query_api.query(org=self.org, query=query)
            hrs = []
            for table in result:
                for record in table.records:
                    val = record.values.get("heartrate")
                    if val is not None:
                        hrs.append(float(val))
            return hrs
        except Exception as e:
            print(f"Error querying latest heartrates: {e}")
            return []
        finally:
            client.close()

    def get_latest_acc_variance(self, device_id: str) -> float:
        """
        Queries InfluxDB for the latest ACC_GYRO samples, parses them,
        and calculates the movement variance (to detect hypotonia).
        """
        client = self._get_client()
        query_api = client.query_api()

        query = f'from(bucket: "{self.bucket}")\n'
        query += f'  |> range(start: -1m)\n'
        query += f'  |> filter(fn: (r) => r["_measurement"] == "biometric_waves")\n'
        query += f'  |> filter(fn: (r) => r["shirt_id"] == "{device_id}")\n'
        query += f'  |> filter(fn: (r) => r["data_type"] == "ACC_GYRO")\n'
        query += f'  |> filter(fn: (r) => r["_field"] == "samples")\n'
        query += f'  |> last()\n'

        try:
            result = query_api.query(org=self.org, query=query)
            for table in result:
                for record in table.records:
                    samples_str = record.get_value()
                    import json
                    import math
                    samples = json.loads(samples_str)
                    if not samples:
                        return 15000.0
                    magnitudes = []
                    for s in samples:
                        x = s.get("x", 0)
                        y = s.get("y", 0)
                        z = s.get("z", 0)
                        magnitudes.append(math.sqrt(x*x + y*y + z*z))
                    mean = sum(magnitudes) / len(magnitudes)
                    variance = sum((m - mean) ** 2 for m in magnitudes) / len(magnitudes)
                    return variance
            return 15000.0
        except Exception as e:
            print(f"Error calculating ACC variance from Influx: {e}")
            return 15000.0
        finally:
            client.close()

    def get_latest_battery_soc(self, device_id: str) -> int:
        """
        Queries InfluxDB for the latest battery state of charge from device_diagnostics.
        """
        client = self._get_client()
        query_api = client.query_api()

        query = f'from(bucket: "{self.bucket}")\n'
        query += f'  |> range(start: -15m)\n'
        query += f'  |> filter(fn: (r) => r["_measurement"] == "device_diagnostics")\n'
        query += f'  |> filter(fn: (r) => r["shirt_id"] == "{device_id}")\n'
        query += f'  |> filter(fn: (r) => r["_field"] == "state_of_charge")\n'
        query += f'  |> last()\n'

        try:
            result = query_api.query(org=self.org, query=query)
            for table in result:
                for record in table.records:
                    val = record.get_value()
                    if val is not None:
                        return int(val)
            return 100
        except Exception as e:
            print(f"Error querying latest battery SoC: {e}")
            return 100
        finally:
            client.close()

    def is_device_active(self, device_id: str, range_start: str = "-5m") -> bool:
        """
        Queries InfluxDB to see if any telemetry (vitals_summary) has been written
        for this device in the last range_start (e.g. -5m).
        """
        client = self._get_client()
        query_api = client.query_api()

        query = f'from(bucket: "{self.bucket}")\n'
        query += f'  |> range(start: {range_start})\n'
        query += f'  |> filter(fn: (r) => r["_measurement"] == "vitals_summary")\n'
        query += f'  |> filter(fn: (r) => r["shirt_id"] == "{device_id}")\n'
        query += f'  |> count()\n'

        try:
            result = query_api.query(org=self.org, query=query)
            for table in result:
                for record in table.records:
                    val = record.get_value()
                    if val and val > 0:
                        return True
            return False
        except Exception as e:
            print(f"Error checking if device is active: {e}")
            return False
        finally:
            client.close()

    def get_acc_window(self, device_id: str, range_start: str = "-3s") -> list:
        """
        Concatena i campioni {x, y, z} di tutti i pacchetti ACC_GYRO nell'ultima
        finestra (~3s), in ordine cronologico, per il rilevamento caduta.
        """
        client = self._get_client()
        query_api = client.query_api()

        query = f'from(bucket: "{self.bucket}")\n'
        query += f'  |> range(start: {range_start})\n'
        query += f'  |> filter(fn: (r) => r["_measurement"] == "biometric_waves")\n'
        query += f'  |> filter(fn: (r) => r["shirt_id"] == "{device_id}")\n'
        query += f'  |> filter(fn: (r) => r["data_type"] == "ACC_GYRO")\n'
        query += f'  |> filter(fn: (r) => r["_field"] == "samples")\n'
        query += f'  |> sort(columns: ["_time"])\n'

        try:
            result = query_api.query(org=self.org, query=query)
            window = []
            for table in result:
                for record in table.records:
                    samples_str = record.get_value()
                    import json
                    samples = json.loads(samples_str) if isinstance(samples_str, str) else (samples_str or [])
                    if samples:
                        window.extend(samples)
            return window
        except Exception as e:
            print(f"Error querying ACC window: {e}")
            return []
        finally:
            client.close()

    def get_breath_gaps(self, device_id: str, range_start: str = "-30s") -> list:
        """
        Analizza il segnale respiratorio grezzo degli ultimi 30 secondi da InfluxDB
        e rileva le pause respiratorie (tratti in cui il segnale è piatto),
        restituendo una lista con le durate in secondi di ciascuna pausa (es. [3.2, 4.1]).
        """
        client = self._get_client()
        query_api = client.query_api()

        query = f'from(bucket: "{self.bucket}")\n'
        query += f'  |> range(start: {range_start})\n'
        query += f'  |> filter(fn: (r) => r["_measurement"] == "biometric_waves")\n'
        query += f'  |> filter(fn: (r) => r["shirt_id"] == "{device_id}")\n'
        query += f'  |> filter(fn: (r) => r["data_type"] == "STRAINGAUGES_MIXED")\n'
        query += f'  |> filter(fn: (r) => r["_field"] == "samples")\n'
        query += f'  |> sort(columns: ["_time"])\n'

        try:
            result = query_api.query(org=self.org, query=query)
            all_samples = []
            freq = 13.3 # Frequenza di campionamento di default (1000/75 ms)
            
            for table in result:
                for record in table.records:
                    samples_str = record.get_value()
                    import json
                    samples = json.loads(samples_str) if isinstance(samples_str, str) else (samples_str or [])
                    if samples:
                        all_samples.extend(samples)
                    record_fields = record.values
                    if "frequency" in record_fields:
                        freq = float(record_fields["frequency"])
            
            if not all_samples or freq <= 0:
                return []
                
            window_size = int(1.5 * freq)
            if window_size <= 0:
                window_size = 15
                
            NOISE_THRESHOLD = 15.0
            
            is_flat = []
            for i in range(len(all_samples)):
                start_idx = max(0, i - window_size // 2)
                end_idx = min(len(all_samples), i + window_size // 2 + 1)
                sub_seg = all_samples[start_idx:end_idx]
                if sub_seg:
                    diff = max(sub_seg) - min(sub_seg)
                    is_flat.append(diff < NOISE_THRESHOLD)
                else:
                    is_flat.append(False)
            
            gaps = []
            in_gap = False
            gap_start = 0
            
            for idx, flat in enumerate(is_flat):
                if flat and not in_gap:
                    in_gap = True
                    gap_start = idx
                elif not flat and in_gap:
                    in_gap = False
                    gap_duration = (idx - gap_start) / freq
                    if 2.0 <= gap_duration <= 10.0:
                        gaps.append(round(gap_duration, 1))
            
            if in_gap:
                gap_duration = (len(is_flat) - gap_start) / freq
                if 2.0 <= gap_duration <= 10.0:
                    gaps.append(round(gap_duration, 1))
                    
            return gaps
        except Exception as e:
            print(f"Error computing breath gaps: {e}")
            return []
        finally:
            client.close()

# Singleton instance
influx_manager = InfluxManager()

