from fastapi import FastAPI, Depends, HTTPException, status, Request, Response, Cookie, Query
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from typing import List, Optional
import jwt
import asyncio
import json
import httpx
import re
from fastapi import WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse

from . import models, schemas, auth, crud, database, mqtt_handler
from .influx_manager import influx_manager

app = FastAPI(title="BabyGuard IoMT API")

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

# --- REAL-TIME BROADCASTER (WebSockets) ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            await connection.send_json(message)

manager = ConnectionManager()

# --- SSE EVENT QUEUE ---
# Una coda globale dove il modulo MQTT infilerà i dati per gli SSE
sse_queue = asyncio.Queue()

async def sse_generator():
    while True:
        # Aspetta che arrivi un nuovo dato dalla coda
        data = await sse_queue.get()
        # Formatta il dato come richiesto dal protocollo SSE
        yield f"data: {json.dumps(data)}\n\n"

# --- INITIALIZE DATABASE & MQTT ---
@app.on_event("startup")
async def startup():
    async with database.engine.begin() as conn:
        # Crea tutte le tabelle se non esistono
        await conn.run_sync(models.Base.metadata.create_all)
    
    # Pre-populate authorized medical IDs if empty
    async with database.AsyncSessionLocal() as session:
        result = await session.execute(select(models.AuthorizedMedicalID))
        if not result.scalars().first():
            # Seed codes from Italian registry (e.g. province prefix + progressive order number)
            real_registry_codes = [
                "RM-45928", "MI-12845", "NA-98312", "TO-67451", "PA-11029",
                "FI-22948", "BO-33102", "GE-44851", "BA-55192", "VE-77041",
                "RM-12345", "MI-67890", "NA-54321"
            ]
            for code in real_registry_codes:
                db_code = models.AuthorizedMedicalID(medical_id=code)
                session.add(db_code)
            await session.commit()
    
    # Passa il manager e la coda al modulo MQTT
    mqtt_handler.manager = manager
    mqtt_handler.sse_queue = sse_queue
    
    # Avvia il loop MQTT in background
    asyncio.create_task(mqtt_handler.mqtt_loop())
    # Avvia il monitoraggio periodico delle apnee in background
    asyncio.create_task(mqtt_handler.apnea_monitor_loop())

# --- WEBSOCKET ENDPOINT ---
@app.websocket("/ws/{neonate_id}")
async def websocket_endpoint(websocket: WebSocket, neonate_id: int):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# --- SSE ENDPOINT ---
@app.get("/sse/{neonate_id}")
async def sse_endpoint(neonate_id: int):
    return StreamingResponse(
        sse_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )

# --- AUTH DEPENDENCY ---
async def get_current_user(token: str = Depends(oauth2_scheme), db: AsyncSession = Depends(database.get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
        token_data = schemas.TokenData(username=username, role=payload.get("role"))
    except jwt.PyJWTError:
        raise credentials_exception
    
    user = await crud.get_user_by_username(db, username=token_data.username)
    if user is None:
        raise credentials_exception
    return user

# --- AUTH ROUTES ---
@app.post("/token", response_model=schemas.Token)
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends(), db: AsyncSession = Depends(database.get_db)):
    user = await crud.get_user_by_username(db, username=form_data.username)
    if not user or not auth.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token = auth.create_access_token(data={"sub": user.username, "role": user.role})
    return {"access_token": access_token, "token_type": "bearer"}

@app.post("/register", response_model=schemas.UserResponse)
async def register_user(user: schemas.UserCreate, db: AsyncSession = Depends(database.get_db)):
    import re
    # 1. Username checks
    username = user.username.strip()
    if len(username) < 4 or len(username) > 20:
        raise HTTPException(status_code=400, detail="Lo username deve contenere tra i 4 e i 20 caratteri.")
    if not re.match(r"^[a-zA-Z0-9_]+$", username):
        raise HTTPException(status_code=400, detail="Lo username può contenere solo lettere, numeri e underscore.")

    # 2. Email checks
    email = user.email.strip()
    if not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", email):
        raise HTTPException(status_code=400, detail="L'indirizzo email fornito non è valido.")

    # 3. Password checks
    password = user.password
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="La password deve contenere almeno 6 caratteri.")
    if not re.search(r"[A-Z]", password) or not re.search(r"[a-z]", password) or not re.search(r"\d", password):
        raise HTTPException(status_code=400, detail="La password deve contenere almeno una lettera maiuscola, una minuscola e un numero.")

    # 4. First name & Last name checks
    if not user.first_name or len(user.first_name.strip()) < 2:
        raise HTTPException(status_code=400, detail="Il nome deve contenere almeno 2 caratteri.")
    if not user.last_name or len(user.last_name.strip()) < 2:
        raise HTTPException(status_code=400, detail="Il cognome deve contenere almeno 2 caratteri.")

    db_user = await crud.get_user_by_username(db, username=user.username)
    if db_user:
        raise HTTPException(status_code=400, detail="Username already registered")
    
    # Validation for doctor registration (Option A - Authorized Medical ID Whitelist)
    if user.role == models.UserRole.DOCTOR or user.role == "doctor":
        if not user.medical_id:
            raise HTTPException(
                status_code=400,
                detail="L'ID medico è obbligatorio per la registrazione come pediatra."
            )
            
        import re
        # Validate structure: XX-YYYYY (e.g. RM-45928, MI-12845)
        if not re.match(r"^[A-Z]{2}-\d{5}$", user.medical_id):
            raise HTTPException(
                status_code=400,
                detail="Formato ID medico non valido. Deve essere nel formato XX-YYYYY (es. RM-45928)."
            )
            
        # Check against AuthorizedMedicalID database whitelist
        stmt = select(models.AuthorizedMedicalID).where(models.AuthorizedMedicalID.medical_id == user.medical_id)
        res = await db.execute(stmt)
        auth_record = res.scalars().first()
        
        if not auth_record:
            raise HTTPException(
                status_code=400,
                detail="Il codice medico fornito non è presente nell'albo dei pediatri autorizzati."
            )
            
        if auth_record.is_used == 1:
            raise HTTPException(
                status_code=400,
                detail="Questo codice medico è già stato utilizzato per un'altra registrazione."
            )
            
        # Mark the medical ID as used in the whitelist
        auth_record.is_used = 1
        
    return await crud.create_user(db=db, user=user)

class RegisterTokenRequest(BaseModel):
    token: str

class SendNotificationRequest(BaseModel):
    title: str
    body: str

@app.post("/register-token")
async def register_token(
    payload: RegisterTokenRequest, 
    current_user: models.UserModel = Depends(get_current_user), 
    db: AsyncSession = Depends(database.get_db)
):
    current_user.push_token = payload.token
    await db.commit()
    return {
        "message": "Token registrato",
        "token": payload.token
    }

@app.post("/send-notification")
async def send_notification(
    payload: SendNotificationRequest,
    db: AsyncSession = Depends(database.get_db)
):
    import requests
    # Retrieve all push tokens
    from sqlalchemy import select
    result = await db.execute(select(models.UserModel.push_token).where(models.UserModel.push_token.isnot(None)))
    tokens = [row[0] for row in result.all() if row[0]]
    
    messages = []
    for token in tokens:
        if token.startswith("ExponentPushToken"):
            messages.append({
                "to": token,
                "sound": "default",
                "title": payload.title,
                "body": payload.body,
                "data": {
                    "screen": "home"
                }
            })
            
    if not messages:
        return {"message": "Nessun token registrato"}
        
    response = requests.post(
        "https://exp.host/--/api/v2/push/send",
        json=messages,
        headers={
            "Content-Type": "application/json"
        }
    )
    return {
        "expo_response": response.json()
    }

# --- NEONATE ROUTES ---
class AssociateDeviceRequest(BaseModel):
    device_id: str

@app.put("/neonates/{neonate_id}/device", response_model=schemas.NeonateResponse)
async def associate_device(
    neonate_id: int,
    payload: AssociateDeviceRequest,
    current_user: models.UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(database.get_db)
):
    if current_user.role != "parent" and current_user.role != models.UserRole.PARENT:
        raise HTTPException(status_code=403, detail="Only parents can associate devices")
    
    # Check parent association
    result = await db.execute(select(models.NeonateModel).where(models.NeonateModel.id == neonate_id))
    neonate = result.scalars().first()
    if not neonate:
        raise HTTPException(status_code=404, detail="Neonate not found")
        
    if neonate.parent_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to manage this neonate")
        
    # Check if this device_id is already associated with another neonate (case-insensitive and trimmed)
    if not payload.device_id or not payload.device_id.strip():
        raise HTTPException(status_code=400, detail="ID Maglietta non valido")
    
    normalized_device_id = payload.device_id.strip().lower()
    payload.device_id = normalized_device_id

    dup_query = select(models.NeonateModel).where(
        func.lower(models.NeonateModel.device_id) == normalized_device_id,
        models.NeonateModel.id != neonate_id
    )
    dup_res = await db.execute(dup_query)
    if dup_res.scalars().first():
        raise HTTPException(status_code=400, detail="La maglietta selezionata è già associata a un genitore.")

    # 1. Check if the shirt is active in InfluxDB
    is_active = influx_manager.is_device_active(normalized_device_id)
    if not is_active:
        raise HTTPException(
            status_code=400,
            detail="La maglietta selezionata non è attiva su InfluxDB (nessun dato ricevuto negli ultimi 5 minuti)."
        )

    # 3. Check doctor's patient limit (max 10 patients per doctor)
    if neonate.doctor_id:
        stmt_doc_limit = (
            select(func.count(models.NeonateModel.id))
            .where(models.NeonateModel.doctor_id == neonate.doctor_id)
            .where(models.NeonateModel.device_id.isnot(None))
            .where(models.NeonateModel.device_id != "")
            .where(models.NeonateModel.id != neonate_id)
        )
        res_doc_limit = await db.execute(stmt_doc_limit)
        doc_patient_count = res_doc_limit.scalar() or 0
        if doc_patient_count >= 10:
            raise HTTPException(
                status_code=400,
                detail="Il pediatra associato a questo bambino ha già raggiunto il limite massimo di 10 pazienti."
            )
        
    neonate.device_id = normalized_device_id
    await db.commit()
    await db.refresh(neonate)
    return neonate

@app.delete("/neonates/{neonate_id}/device", response_model=schemas.NeonateResponse)
async def dissociate_device(
    neonate_id: int,
    current_user: models.UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(database.get_db)
):
    if current_user.role != "parent" and current_user.role != models.UserRole.PARENT:
        raise HTTPException(status_code=403, detail="Only parents can dissociate devices")
        
    result = await db.execute(select(models.NeonateModel).where(models.NeonateModel.id == neonate_id))
    neonate = result.scalars().first()
    if not neonate:
        raise HTTPException(status_code=404, detail="Neonate not found")
        
    if neonate.parent_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to manage this neonate")
        
    old_device_id = neonate.device_id
    neonate.device_id = None
    await db.commit()
    await db.refresh(neonate)
    
    # Remove from active states
    if old_device_id and old_device_id in mqtt_handler.device_states:
        del mqtt_handler.device_states[old_device_id]
        
    return neonate

@app.delete("/neonates/{neonate_id}")
async def delete_neonate(
    neonate_id: int,
    current_user: models.UserModel = Depends(get_current_user),
    db: AsyncSession = Depends(database.get_db)
):
    if current_user.role != "parent" and current_user.role != models.UserRole.PARENT:
        raise HTTPException(status_code=403, detail="Only parents can delete neonate profiles")
        
    result = await db.execute(select(models.NeonateModel).where(models.NeonateModel.id == neonate_id))
    neonate = result.scalars().first()
    if not neonate:
        raise HTTPException(status_code=404, detail="Neonate not found")
        
    if neonate.parent_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to manage this neonate")
        
    old_device_id = neonate.device_id
    success = await crud.delete_neonate(db, neonate_id=neonate_id)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to delete neonate")
        
    # Remove from active states
    if old_device_id and old_device_id in mqtt_handler.device_states:
        del mqtt_handler.device_states[old_device_id]
        
    return {"message": "Neonate deleted successfully", "id": neonate_id}

@app.post("/neonates", response_model=schemas.NeonateResponse)
async def create_neonate(neonate: schemas.NeonateCreate, current_user: models.UserModel = Depends(get_current_user), db: AsyncSession = Depends(database.get_db)):
    if current_user.role != models.UserRole.PARENT and current_user.role != "parent" and current_user.role != models.UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Only parents or admins can register neonates")

    # Normalize and validate device_id: strip, lower, and check it is not empty
    if not neonate.device_id or not neonate.device_id.strip():
        raise HTTPException(
            status_code=400,
            detail="L'ID maglietta è obbligatorio per completare la registrazione."
        )

    normalized_device_id = neonate.device_id.strip().lower()
    neonate.device_id = normalized_device_id

    # 1. Check if this device_id is already associated with any neonate (case-insensitive)
    stmt_device = select(models.NeonateModel).where(
        func.lower(models.NeonateModel.device_id) == normalized_device_id
    )
    res_device = await db.execute(stmt_device)
    if res_device.scalars().first():
        raise HTTPException(
            status_code=400,
            detail="La maglietta selezionata è già associata a un genitore."
        )

    # 3. Check if the doctor exists
    doc_result = await db.execute(
        select(models.UserModel).where(
            models.UserModel.id == neonate.doctor_id,
            models.UserModel.role == "doctor"
        )
    )
    doctor_user = doc_result.scalars().first()
    if not doctor_user:
        raise HTTPException(
            status_code=400,
            detail="Il pediatra selezionato non esiste."
        )

    # 4. Check if the doctor is busy with 10 or more patients/shirts
    stmt_doc_limit = (
        select(func.count(models.NeonateModel.id))
        .where(models.NeonateModel.doctor_id == neonate.doctor_id)
        .where(models.NeonateModel.device_id.isnot(None))
        .where(models.NeonateModel.device_id != "")
    )
    res_doc_limit = await db.execute(stmt_doc_limit)
    doc_patient_count = res_doc_limit.scalar() or 0
    if doc_patient_count >= 10:
        raise HTTPException(
            status_code=400,
            detail="Il pediatra selezionato ha già raggiunto il limite massimo di 10 pazienti."
        )

    # 5. Check if the device is active in InfluxDB
    is_active = influx_manager.is_device_active(normalized_device_id)
    if not is_active:
        raise HTTPException(
            status_code=400,
            detail="La maglietta selezionata non è attiva su InfluxDB (nessun dato ricevuto negli ultimi 5 minuti)."
        )

    return await crud.create_neonate(db=db, neonate=neonate, parent_id=current_user.id)

@app.get("/neonates", response_model=List[schemas.NeonateResponse])
async def read_neonates(skip: int = 0, limit: int = 100, current_user: models.UserModel = Depends(get_current_user), db: AsyncSession = Depends(database.get_db)):
    if current_user.role == models.UserRole.DOCTOR or current_user.role == "doctor":
        return await crud.get_neonates_by_doctor(db, doctor_id=current_user.id)
    elif current_user.role == models.UserRole.PARENT or current_user.role == "parent":
        return await crud.get_neonates_by_parent(db, parent_id=current_user.id)
    else:
        return await crud.get_neonates(db, skip=skip, limit=limit)

@app.get("/doctors", response_model=List[schemas.UserResponse])
async def read_doctors(db: AsyncSession = Depends(database.get_db), current_user: models.UserModel = Depends(get_current_user)):
    # Subquery to count patients with devices per doctor
    subq = (
        select(models.NeonateModel.doctor_id, func.count(models.NeonateModel.id).label("patient_count"))
        .where(models.NeonateModel.device_id.isnot(None))
        .where(models.NeonateModel.device_id != "")
        .group_by(models.NeonateModel.doctor_id)
        .subquery()
    )

    # Query doctors who have fewer than 10 patients or no patient at all
    query = (
        select(models.UserModel)
        .outerjoin(subq, models.UserModel.id == subq.c.doctor_id)
        .where(models.UserModel.role == "doctor")
        .where(or_(subq.c.patient_count == None, subq.c.patient_count < 10))
    )
    
    result = await db.execute(query)
    return result.scalars().all()

@app.put("/alerts/{alert_id}/resolve", response_model=schemas.AlertResponse)
async def resolve_alert(alert_id: int, db: AsyncSession = Depends(database.get_db), current_user: models.UserModel = Depends(get_current_user)):
    result = await db.execute(select(models.AlertModel).where(models.AlertModel.id == alert_id))
    alert = result.scalars().first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
        
    # Fetch neonate to verify ownership
    neonate_res = await db.execute(select(models.NeonateModel).where(models.NeonateModel.id == alert.neonate_id))
    neonate = neonate_res.scalars().first()
    if not neonate:
        raise HTTPException(status_code=404, detail="Neonate not found")

    is_authorized = False
    if current_user.role == "parent" or current_user.role == models.UserRole.PARENT:
        if neonate.parent_id == current_user.id:
            is_authorized = True
    elif current_user.role == "doctor" or current_user.role == models.UserRole.DOCTOR:
        if neonate.doctor_id == current_user.id:
            is_authorized = True
    elif current_user.role == "admin" or current_user.role == models.UserRole.ADMIN:
        is_authorized = True
        
    if not is_authorized:
        raise HTTPException(status_code=403, detail="Not authorized to manage this alert")
        
    alert.is_resolved = 1
    await db.commit()
    await db.refresh(alert)
    
    resolve_event = {
        "event": "alert_resolved",
        "alert_id": alert_id,
        "neonate_id": alert.neonate_id
    }
    if manager:
        await manager.broadcast(resolve_event)
        
    return alert

# --- MONITORING & ALERTS ---
@app.get("/neonates/{neonate_id}/thresholds", response_model=schemas.ThresholdResponse)
async def read_thresholds(neonate_id: int, db: AsyncSession = Depends(database.get_db)):
    thresholds = await crud.get_thresholds(db, neonate_id=neonate_id)
    if not thresholds:
        raise HTTPException(status_code=404, detail="Thresholds not found")
    return thresholds

@app.put("/neonates/{neonate_id}/thresholds", response_model=schemas.ThresholdResponse)
async def update_thresholds(neonate_id: int, thresholds: schemas.ThresholdUpdate, current_user: models.UserModel = Depends(get_current_user), db: AsyncSession = Depends(database.get_db)):
    if current_user.role != models.UserRole.DOCTOR:
        raise HTTPException(status_code=403, detail="Only doctors can update thresholds")
    return await crud.update_thresholds(db, neonate_id=neonate_id, thresholds=thresholds)

@app.get("/neonates/{neonate_id}/alerts", response_model=List[schemas.AlertResponse])
async def read_alerts(neonate_id: int, db: AsyncSession = Depends(database.get_db)):
    return await crud.get_alerts_by_neonate(db, neonate_id=neonate_id)

# --- INFLUXDB HISTORICAL ROUTES ---
@app.get("/neonates/{neonate_id}/history/{metric}")
async def read_neonate_history(
    neonate_id: int, 
    metric: str, 
    range_start: str = "-2h", 
    aggregate_window: str = None, 
    db: AsyncSession = Depends(database.get_db),
    current_user: models.UserModel = Depends(get_current_user)
):
    # Fetch neonate to check access and get device_id
    result = await db.execute(select(models.NeonateModel).where(models.NeonateModel.id == neonate_id))
    neonate = result.scalars().first()
    if not neonate:
        raise HTTPException(status_code=404, detail="Neonate not found")
        
    if not neonate.device_id:
        raise HTTPException(status_code=400, detail="Neonate has no device associated")
    
    # Map friendly metric names to InfluxDB field names
    field_map = {
        "heart_rate": "heartrate",
        "heartrate": "heartrate",
        "temperature": "temperature",
        "temp": "temperature",
        "breath_rate": "breathrate",
        "breathrate": "breathrate",
        "orientation": "orientation"
    }
    
    field_name = field_map.get(metric.lower(), metric)
    
    data = influx_manager.query_historical_field(
        device_id=neonate.device_id,
        field_name=field_name,
        range_start=range_start,
        aggregate_window=aggregate_window
    )
    return {"neonate_id": neonate_id, "device_id": neonate.device_id, "metric": field_name, "data": data}

@app.get("/neonates/{neonate_id}/stats/{metric}")
async def read_neonate_stats(
    neonate_id: int, 
    metric: str, 
    range_start: str = "-2h", 
    db: AsyncSession = Depends(database.get_db),
    current_user: models.UserModel = Depends(get_current_user)
):
    result = await db.execute(select(models.NeonateModel).where(models.NeonateModel.id == neonate_id))
    neonate = result.scalars().first()
    if not neonate:
        raise HTTPException(status_code=404, detail="Neonate not found")
        
    if not neonate.device_id:
        raise HTTPException(status_code=400, detail="Neonate has no device associated")
        
    field_map = {
        "heart_rate": "heartrate",
        "heartrate": "heartrate",
        "temperature": "temperature",
        "temp": "temperature",
        "breath_rate": "breathrate",
        "breathrate": "breathrate",
        "orientation": "orientation"
    }
    
    field_name = field_map.get(metric.lower(), metric)
    
    avg_value = influx_manager.get_average_metric(
        device_id=neonate.device_id,
        field_name=field_name,
        range_start=range_start
    )
    return {"neonate_id": neonate_id, "device_id": neonate.device_id, "metric": field_name, "range_start": range_start, "average": avg_value}

@app.get("/neonates/{neonate_id}/ahi")
async def read_neonate_ahi(
    neonate_id: int,
    range_start: str = "-24h",
    db: AsyncSession = Depends(database.get_db),
    current_user: models.UserModel = Depends(get_current_user)
):
    result = await db.execute(select(models.NeonateModel).where(models.NeonateModel.id == neonate_id))
    neonate = result.scalars().first()
    if not neonate:
        raise HTTPException(status_code=404, detail="Neonate not found")
        
    if not neonate.device_id:
        return {
            "neonate_id": neonate_id,
            "ahi_index": 0.0,
            "apnea_count": 0,
            "hours": 0.0,
            "status": "No device associated"
        }

    # Query InfluxDB for active monitoring hours
    hours = influx_manager.get_active_monitoring_hours(device_id=neonate.device_id, range_start=range_start)
    
    # Map range_start to Python datetime to query SQLite
    import datetime
    time_delta = datetime.timedelta(hours=24) # default
    
    if range_start.endswith("h"):
        try:
            val = int(range_start.strip("-").strip("h"))
            time_delta = datetime.timedelta(hours=val)
        except:
            pass
    elif range_start.endswith("d"):
        try:
            val = int(range_start.strip("-").strip("d"))
            time_delta = datetime.timedelta(days=val)
        except:
            pass
    elif range_start.endswith("m"):
        try:
            val = int(range_start.strip("-").strip("m"))
            time_delta = datetime.timedelta(minutes=val)
        except:
            pass
            
    since_time = datetime.datetime.utcnow() - time_delta
    
    # Query SQL database for count of apneas
    from sqlalchemy import func
    alert_query = select(func.count(models.AlertModel.id)).where(
        models.AlertModel.neonate_id == neonate_id,
        models.AlertModel.type.in_(["Apnea", "SIDS"]),
        models.AlertModel.timestamp >= since_time
    )
    alert_res = await db.execute(alert_query)
    apnea_count = alert_res.scalar() or 0
    
    # Calculate AHI Index (Ratio: apneas / hours)
    # AHI is calculated if there's at least 3.6 seconds of active data for testing
    if hours >= 0.001:
        ahi = apnea_count / hours
    else:
        ahi = 0.0
        
    return {
        "neonate_id": neonate_id,
        "device_id": neonate.device_id,
        "range_start": range_start,
        "ahi_index": round(ahi, 2),
        "apnea_count": apnea_count,
        "hours": round(hours, 2),
        "status": "Normal" if ahi < 5 else "Mild" if ahi < 15 else "Moderate" if ahi < 30 else "Severe"
    }


# --- REAL-TIME DATA (SSE/Websocket placeholders) ---
@app.get("/")
def root():
    return {"message": "Welcome to BabyGuard IoMT API"}


# --- DOCTOR DASHBOARD LINK GENERATOR ---
@app.get("/api/doctors/dashboard-url")
async def get_doctor_dashboard_url(
    current_user: models.UserModel = Depends(get_current_user)
):
    if current_user.role != "doctor" and current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Accesso negato: solo i pediatri e gli amministratori possono accedere alla dashboard"
        )
    # Genera un token specifico per Grafana (scade in 1 giorno come l'access token)
    grafana_token = auth.create_access_token(
        data={"sub": current_user.username, "role": current_user.role}
    )
    # Ritorna il percorso completo
    return {"url": f"/grafana/d/babyguard-clinical-dashboard?token={grafana_token}"}


# --- SECURE GRAFANA REVERSE PROXY ROUTE WITH DATA ISOLATION ---
@app.api_route("/grafana/{path:path}", methods=["GET", "POST", "PUT", "DELETE"])
async def grafana_proxy(
    path: str,
    request: Request,
    token: Optional[str] = Query(None),
    grafana_token: Optional[str] = Cookie(None),
    db: AsyncSession = Depends(database.get_db)
):
    # 1. Recupera il token da query param o da cookie
    active_token = token or grafana_token
    
    # 2. Verifica e decodifica il token
    user = None
    if active_token:
        try:
            payload = jwt.decode(active_token, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])
            username: str = payload.get("sub")
            if username:
                stmt = select(models.UserModel).where(models.UserModel.username == username)
                res = await db.execute(stmt)
                user = res.scalars().first()
        except jwt.PyJWTError:
            pass
            
    # Se stiamo accedendo alle pagine o alle API critiche di Grafana e non siamo autenticati, blocchiamo
    is_critical_path = path.startswith("d/") or path == "" or path.startswith("api/") or path.startswith("login")
    if not user and is_critical_path:
        return Response("Non autorizzato: Sessione non valida o scaduta.", status_code=401)

    # 3. Se l'utente è valido, trova i suoi pazienti associati (device_ids / shirt_ids)
    allowed_shirts = []
    if user:
        if user.role == "admin":
            stmt = select(models.NeonateModel.device_id)
            res = await db.execute(stmt)
            allowed_shirts = [row[0] for row in res.all() if row[0] is not None]
        elif user.role == "doctor":
            stmt = select(models.NeonateModel.device_id).where(models.NeonateModel.doctor_id == user.id)
            res = await db.execute(stmt)
            allowed_shirts = [row[0] for row in res.all() if row[0] is not None]
        else:
            # Per i genitori, mostriamo solo i propri neonati
            stmt = select(models.NeonateModel.device_id).where(models.NeonateModel.parent_id == user.id)
            res = await db.execute(stmt)
            allowed_shirts = [row[0] for row in res.all() if row[0] is not None]

    # 4. Prepara gli header da inoltrare a Grafana
    headers = dict(request.headers)
    headers.pop("host", None)
    headers.pop("content-length", None)
    
    # Inietta gli header per l'Auth Proxy di Grafana
    if user:
        headers["X-WEBAUTH-USER"] = user.username
        headers["X-WEBAUTH-EMAIL"] = user.email or f"{user.username}@babyguard.local"
        headers["X-WEBAUTH-ROLE"] = "Admin" if user.role == "admin" else "Viewer"

    method = request.method
    body = await request.body()

    # 5. Intercetta e filtra le query inviate a InfluxDB per isolare i dati
    if method == "POST" and path == "api/ds/query" and user:
        try:
            req_data = json.loads(body)
            modified = False
            for q in req_data.get("queries", []):
                datasource = q.get("datasource", {})
                if datasource.get("type") == "influxdb":
                    flux_query = q.get("query", "")
                    
                    # A. Se è la query per la lista dei neonati (dropdown del menu a tendina), mostra solo quelli autorizzati
                    if "schema.tagValues" in flux_query:
                        if allowed_shirts:
                            rows_str = ", ".join([f'{{"value": "{s}"}}' for s in allowed_shirts])
                            new_query = f'import "array"\narray.from(rows: [{rows_str}])'
                        else:
                            new_query = 'import "array"\narray.from(rows: [{"value": "Nessun paziente"}])'
                        q["query"] = new_query
                        modified = True
                        
                    # B. Se è una query di telemetria, verifica che il neonato richiesto sia tra quelli autorizzati
                    elif "shirt_id" in flux_query:
                        match = re.search(r'(?:r\["shirt_id"\]|r\.shirt_id)\s*==\s*["\']([^"\']+)["\']', flux_query)
                        if match:
                            queried_id = match.group(1)
                            if queried_id not in allowed_shirts:
                                # Sostituisce l'ID cercato con una stringa fittizia per non ritornare dati
                                new_query = re.sub(
                                    r'(?:r\["shirt_id"\]|r\.shirt_id)\s*==\s*["\']([^"\']+)["\']',
                                    'r["shirt_id"] == "UNAUTHORIZED_ACCESS_BLOCKED"',
                                    flux_query
                                )
                                q["query"] = new_query
                                modified = True
                                
            if modified:
                body = json.dumps(req_data).encode("utf-8")
                headers["content-length"] = str(len(body))
        except Exception:
            pass

    # 6. Inoltra la richiesta al container di Grafana
    # Grafana è raggiungibile all'interno della rete Docker come 'http://grafana:3000'
    grafana_url = f"http://grafana:3000/grafana/{path}"
    
    async with httpx.AsyncClient() as client:
        params = dict(request.query_params)
        params.pop("token", None) # Rimuove il token query param prima dell'inoltro
        
        req_params = []
        for k, v in params.items():
            req_params.append((k, v))
            
        try:
            proxy_resp = await client.request(
                method=method,
                url=grafana_url,
                headers=headers,
                params=req_params,
                content=body,
                cookies=request.cookies,
                timeout=30.0
            )
        except Exception as e:
            return Response(f"Errore di connessione a Grafana: {str(e)}", status_code=502)

        # Rimuove gli header di compressione e connessione che gestirà uvicorn
        exclude_headers = [
            "content-encoding",
            "content-length",
            "transfer-encoding",
            "connection",
        ]
        resp_headers = {
            k: v for k, v in proxy_resp.headers.items()
            if k.lower() not in exclude_headers
        }

        # Genera la risposta in streaming
        res = StreamingResponse(
            proxy_resp.aiter_bytes(),
            status_code=proxy_resp.status_code,
            headers=resp_headers
        )

        # Se abbiamo validato un token query param, impostiamo il cookie per le richieste successive degli asset
        if token and user:
            res.set_cookie(
                key="grafana_token",
                value=token,
                httponly=True,
                samesite="lax",
                path="/grafana"
            )
            
        return res
