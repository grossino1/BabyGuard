from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from . import models, schemas, auth

# --- USER CRUD ---
async def get_user_by_username(db: AsyncSession, username: str):
    result = await db.execute(select(models.UserModel).where(models.UserModel.username == username))
    return result.scalars().first()

async def create_user(db: AsyncSession, user: schemas.UserCreate):
    hashed_pwd = auth.hash_password(user.password)
    db_user = models.UserModel(
        username=user.username,
        email=user.email,
        hashed_password=hashed_pwd,
        role=user.role,
        first_name=user.first_name,
        last_name=user.last_name,
        medical_id=user.medical_id,
        push_token=user.push_token
    )
    db.add(db_user)
    await db.commit()
    await db.refresh(db_user)
    return db_user

def calculate_age_months(birth_date) -> int:
    if not birth_date:
        return 0
    from datetime import datetime
    now = datetime.now()
    if hasattr(birth_date, "tzinfo") and birth_date.tzinfo is not None:
        now = now.astimezone(birth_date.tzinfo)
    delta = now - birth_date
    return max(0, int(delta.days / 30.4375))

# --- NEONATE CRUD ---
async def create_neonate(db: AsyncSession, neonate: schemas.NeonateCreate, parent_id: int):
    neonate_data = neonate.model_dump()
    doctor_id = neonate_data.pop("doctor_id")
    
    db_neonate = models.NeonateModel(
        **neonate_data,
        parent_id=parent_id,
        doctor_id=doctor_id
    )
    db.add(db_neonate)
    await db.commit()
    await db.refresh(db_neonate)
    
    # Create default thresholds
    db_thresholds = models.ThresholdModel(neonate_id=db_neonate.id)
    db.add(db_thresholds)
    
    await db.commit()
    db_neonate.age = calculate_age_months(db_neonate.birth_date)
    return db_neonate

async def update_neonate(db: AsyncSession, neonate_id: int, neonate_update: schemas.NeonateUpdate):
    result = await db.execute(select(models.NeonateModel).where(models.NeonateModel.id == neonate_id))
    db_neonate = result.scalars().first()
    if not db_neonate:
        return None
    
    update_data = neonate_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_neonate, key, value)
        
    await db.commit()
    await db.refresh(db_neonate)
    db_neonate.age = calculate_age_months(db_neonate.birth_date)
    return db_neonate

async def get_neonates_by_parent(db: AsyncSession, parent_id: int):
    result = await db.execute(
        select(models.NeonateModel)
        .where(models.NeonateModel.parent_id == parent_id)
    )
    neonates = result.scalars().all()
    for n in neonates:
        n.age = calculate_age_months(n.birth_date)
    return neonates

async def delete_neonate(db: AsyncSession, neonate_id: int):
    from sqlalchemy import delete
    await db.execute(delete(models.ThresholdModel).where(models.ThresholdModel.neonate_id == neonate_id))
    await db.execute(delete(models.AlertModel).where(models.AlertModel.neonate_id == neonate_id))
    result = await db.execute(select(models.NeonateModel).where(models.NeonateModel.id == neonate_id))
    neonate = result.scalars().first()
    if neonate:
        await db.delete(neonate)
        await db.commit()
        return True
    return False

async def get_neonates_by_doctor(db: AsyncSession, doctor_id: int):
    result = await db.execute(
        select(models.NeonateModel)
        .where(models.NeonateModel.doctor_id == doctor_id)
    )
    neonates = result.scalars().all()
    for n in neonates:
        n.age = calculate_age_months(n.birth_date)
    return neonates

async def get_neonates(db: AsyncSession, skip: int = 0, limit: int = 100):
    result = await db.execute(select(models.NeonateModel).offset(skip).limit(limit))
    neonates = result.scalars().all()
    for n in neonates:
        n.age = calculate_age_months(n.birth_date)
    return neonates



# --- THRESHOLD CRUD ---
async def get_thresholds(db: AsyncSession, neonate_id: int):
    result = await db.execute(select(models.ThresholdModel).where(models.ThresholdModel.neonate_id == neonate_id))
    thresholds = result.scalars().first()
    if not thresholds:
        thresholds = models.ThresholdModel(neonate_id=neonate_id)
        db.add(thresholds)
        await db.commit()
        await db.refresh(thresholds)
    return thresholds

async def update_thresholds(db: AsyncSession, neonate_id: int, thresholds: schemas.ThresholdUpdate):
    db_thresholds = await get_thresholds(db, neonate_id)
    if db_thresholds:
        for key, value in thresholds.model_dump().items():
            setattr(db_thresholds, key, value)
        await db.commit()
        await db.refresh(db_thresholds)
    return db_thresholds

# --- ALERT CRUD ---
import datetime

async def create_alert(db: AsyncSession, neonate_id: int, type: str, message: str, severity: str):
    # Check for existing unresolved alert of the same type
    stmt = select(models.AlertModel).where(
        models.AlertModel.neonate_id == neonate_id,
        models.AlertModel.type == type,
        models.AlertModel.is_resolved == 0
    )
    result = await db.execute(stmt)
    existing_alert = result.scalars().first()
    
    if existing_alert:
        existing_alert.message = message
        existing_alert.severity = severity
        existing_alert.timestamp = datetime.datetime.utcnow()
        await db.commit()
        await db.refresh(existing_alert)
        return existing_alert
    else:
        db_alert = models.AlertModel(neonate_id=neonate_id, type=type, message=message, severity=severity)
        db.add(db_alert)
        await db.commit()
        await db.refresh(db_alert)
        return db_alert

async def get_alerts_by_neonate(db: AsyncSession, neonate_id: int):
    result = await db.execute(select(models.AlertModel).where(models.AlertModel.neonate_id == neonate_id).order_by(models.AlertModel.timestamp.desc()))
    return result.scalars().all()
