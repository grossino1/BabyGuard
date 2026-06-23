from influxdb_client import InfluxDBClient

url = "http://influxdb:8086"
token = "my-super-secret-auth-token"
org = "iomt-lab"
bucket = "babyguard_bucket"

client = InfluxDBClient(url=url, token=token, org=org)
query_api = client.query_api()

query = 'import "influxdata/influxdb/schema"\nschema.tagValues(bucket: "babyguard_bucket", tag: "shirt_id")'

try:
    result = query_api.query(org=org, query=query)
    tags = []
    for table in result:
        for record in table.records:
            tags.append(record.get_value())
    print("TAGS_FOUND:", tags)
except Exception as e:
    print("ERROR_INFLUX:", e)
finally:
    client.close()
