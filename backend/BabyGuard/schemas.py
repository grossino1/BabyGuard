from pydantic import BaseModel, EmailStr
from typing import List, Optional
from datetime import datetime
from .models import UserRole

# --- USER SCHEMAS ---
class UserBase(BaseModel):
    username: str
    email: EmailStr
    role: UserRole
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    medical_id: Optional[str] = None
    push_token: Optional[str] = None

class UserCreate(UserBase):
    password: str

class UserResponse(UserBase):
    id: int
    class Config:
        from_attributes = True

# --- NEONATE SCHEMAS ---
class NeonateBase(BaseModel):
    first_name: str
    last_name: str
    birth_date: datetime
    gender: str
    device_id: Optional[str] = None
    height: Optional[float] = None
    weight: Optional[float] = None
    age: Optional[int] = None

class NeonateCreate(NeonateBase):
    doctor_id: int

class NeonateResponse(NeonateBase):
    id: int
    class Config:
        from_attributes = True

# --- THRESHOLD SCHEMAS ---
class ThresholdBase(BaseModel):
    hr_min: int
    hr_max: int
    br_min: int
    br_max: int
    temp_min: float
    temp_max: float

class ThresholdUpdate(ThresholdBase):
    pass

class ThresholdResponse(ThresholdBase):
    id: int
    neonate_id: int
    class Config:
        from_attributes = True

# --- ALERT SCHEMAS ---
class AlertResponse(BaseModel):
    id: int
    neonate_id: int
    type: str
    message: str
    severity: str
    timestamp: datetime
    is_resolved: bool
    class Config:
        from_attributes = True

# --- AUTH SCHEMAS ---
class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    username: Optional[str] = None
    role: Optional[str] = None
