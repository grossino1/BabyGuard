FROM python:3.12-slim

RUN apt-get update && apt-get install -y \
    git \
    curl \
    lsof \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "BabyGuard.main:app", "--host", "0.0.0.0", "--port", "8000"]
#backend_Libri/websocket_see=nome della cartella dove c'è il main