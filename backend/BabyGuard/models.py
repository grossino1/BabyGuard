from sqlalchemy import Column, Integer, String, Float, ForeignKey, DateTime, Enum
from sqlalchemy.orm import relationship
from .database import Base
import datetime
import enum

class UserRole(str, enum.Enum):
    ADMIN = "admin"
    DOCTOR = "doctor"
    PARENT = "parent"

class UserModel(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    email = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    role = Column(String, default=UserRole.PARENT)
    first_name = Column(String, nullable=True)
    last_name = Column(String, nullable=True)
    medical_id = Column(String, nullable=True)
    push_token = Column(String, nullable=True)


    # Relationships
    patients_as_doctor = relationship("NeonateModel", back_populates="doctor", foreign_keys="NeonateModel.doctor_id")
    patients_as_parent = relationship("NeonateModel", back_populates="parent", foreign_keys="NeonateModel.parent_id")

class NeonateModel(Base):
    __tablename__ = "neonates"
    
    id = Column(Integer, primary_key=True, index=True)
    first_name = Column(String)
    last_name = Column(String)
    birth_date = Column(DateTime)
    gender = Column(String)
    device_id = Column(String, unique=True, index=True, nullable=True) # Linked to InfluxDB tag
    height = Column(Float, nullable=True)
    weight = Column(Float, nullable=True)
    age = Column(Integer, nullable=True)
    
    parent_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    doctor_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    # Relationships
    doctor = relationship("UserModel", back_populates="patients_as_doctor", foreign_keys=[doctor_id])
    parent = relationship("UserModel", back_populates="patients_as_parent", foreign_keys=[parent_id])
    thresholds = relationship("ThresholdModel", back_populates="neonate", uselist=False)
    alerts = relationship("AlertModel", back_populates="neonate")

class ThresholdModel(Base):
    __tablename__ = "thresholds"
    id = Column(Integer, primary_key=True, index=True)
    neonate_id = Column(Integer, ForeignKey("neonates.id"), unique=True)
    
    hr_min = Column(Integer, default=60)
    hr_max = Column(Integer, default=160)
    br_min = Column(Integer, default=20)
    br_max = Column(Integer, default=60)
    temp_min = Column(Float, default=36.0)
    temp_max = Column(Float, default=38.0)

    neonate = relationship("NeonateModel", back_populates="thresholds")

class AlertModel(Base):
    __tablename__ = "alerts"
    id = Column(Integer, primary_key=True, index=True)
    neonate_id = Column(Integer, ForeignKey("neonates.id"))
    
    type = Column(String) # HR, BR, Temp, Position, Battery
    message = Column(String)
    severity = Column(String) # low, medium, high, critical
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)
    is_resolved = Column(Integer, default=0)

    neonate = relationship("NeonateModel", back_populates="alerts")


class AuthorizedMedicalID(Base):
    __tablename__ = "authorized_medical_ids"
    id = Column(Integer, primary_key=True, index=True)
    medical_id = Column(String, unique=True, index=True, nullable=False)
    is_used = Column(Integer, default=0)  # 0 = false, 1 = true
