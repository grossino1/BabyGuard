import asyncio
import os
import random
import datetime
import httpx
from sqlalchemy import select
from .database import AsyncSessionLocal
from . import models

# Dettagli del Bot di default per la demo
DEFAULT_BOT_TOKEN = "8863483521:AAGDBTn1aNc0brROrA4IP8lVAdSbR-FDvfk"
BOT_USERNAME = "BabyGuardNotifyBot"

# Token del Bot caricato da variabili d'ambiente o di default
BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
if not BOT_TOKEN or BOT_TOKEN == "il_tuo_token_qui" or BOT_TOKEN.strip() == "" or BOT_TOKEN == "inserisci_qui_il_tuo_token_del_bot_telegram":
    BOT_TOKEN = DEFAULT_BOT_TOKEN

# Mappa in memoria per memorizzare i codici di associazione temporanei
# Struttura: { "codice_6_cifre": user_id }
link_codes = {}

def generate_link_code(user_id: int) -> str:
    """Genera un codice univoco temporaneo a 6 cifre per associare l'utente a Telegram."""
    # Rimuove eventuali codici precedentemente generati per lo stesso utente
    to_remove = [k for k, v in link_codes.items() if v == user_id]
    for k in to_remove:
        del link_codes[k]
    
    # Genera un nuovo codice non in uso
    while True:
        code = f"{random.randint(100000, 999999)}"
        if code not in link_codes:
            link_codes[code] = user_id
            return code

async def send_telegram_message_direct(chat_id: int, text: str):
    """Invia un messaggio Telegram diretto utilizzando le API HTTP."""
    if not BOT_TOKEN or BOT_TOKEN == "il_tuo_token_qui" or BOT_TOKEN.strip() == "":
        return
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
            payload = {
                "chat_id": chat_id,
                "text": text,
                "parse_mode": "HTML"
            }
            response = await client.post(url, json=payload)
            if response.status_code != 200:
                print(f"[TELEGRAM] Errore sendMessage a {chat_id}: status {response.status_code}, response: {response.text}")
    except Exception as e:
        print(f"[TELEGRAM] Eccezione nell'invio messaggio a {chat_id}: {e}")

async def handle_telegram_message(chat_id: int, text: str):
    """Gestisce i messaggi in ingresso inviati al bot Telegram."""
    text = text.strip()
    if text.startswith("/start"):
        parts = text.split(maxsplit=1)
        if len(parts) > 1:
            code = parts[1].strip()
            if code in link_codes:
                user_id = link_codes[code]
                
                # Associa il chat_id all'utente nel database
                async with AsyncSessionLocal() as session:
                    result = await session.execute(
                        select(models.UserModel).where(models.UserModel.id == user_id)
                    )
                    user = result.scalars().first()
                    if user:
                        user.telegram_chat_id = str(chat_id)
                        await session.commit()
                        
                        # Rimuove il codice usato
                        del link_codes[code]
                        
                        nome = user.first_name or user.username
                        await send_telegram_message_direct(
                            chat_id,
                            f"✅ <b>Associazione completata con successo!</b>\n\n"
                            f"Ciao {nome}, il tuo account BabyGuard (username: {user.username}) "
                            f"è stato associato correttamente.\n"
                            f"Da ora riceverai qui gli avvisi e le allerte del neonato in tempo reale."
                        )
                        print(f"[TELEGRAM] Utente '{user.username}' associato con successo a chat_id: {chat_id}")
                    else:
                        await send_telegram_message_direct(
                            chat_id,
                            "❌ <b>Errore:</b> Utente non trovato nel database."
                        )
            else:
                await send_telegram_message_direct(
                    chat_id,
                    "❌ <b>Codice non valido o scaduto.</b>\n"
                    "Genera un nuovo codice dall'app mobile BabyGuard e invialo scrivendo: `/start <codice>`."
                )
        else:
            await send_telegram_message_direct(
                chat_id,
                "👋 <b>Benvenuto nel Bot Telegram di BabyGuard!</b>\n\n"
                "Per ricevere gli avvisi sui neonati monitorati direttamente qui, "
                "devi associare il tuo profilo.\n\n"
                "1. Accedi all'applicazione mobile BabyGuard.\n"
                "2. Vai nelle impostazioni di Telegram e richiedi un codice di associazione.\n"
                "3. Invia qui il codice in questo formato:\n"
                "   <code>/start &lt;codice&gt;</code>\n\n"
                "<i>Esempio: /start 123456</i>"
            )
    elif text.startswith("/help"):
        await send_telegram_message_direct(
            chat_id,
            "ℹ️ <b>Supporto BabyGuard Bot</b>\n\n"
            "Questo bot invia allerte critiche e anomale provenienti dalle magliette smart dei neonati.\n\n"
            "Comandi disponibili:\n"
            "- `/start &lt;codice&gt;`: Associa il tuo profilo usando il codice generato dall'app.\n"
            "- `/help`: Mostra questa guida."
        )
    else:
        await send_telegram_message_direct(
            chat_id,
            "⚠️ <b>Istruzione non riconosciuta.</b>\n"
            "Per associare il tuo profilo usa il comando:\n"
            "<code>/start &lt;codice&gt;</code>"
        )

async def start_telegram_polling():
    """Avvia il polling periodico per ricevere i messaggi da Telegram in background."""
    if not BOT_TOKEN or BOT_TOKEN == "il_tuo_token_qui" or BOT_TOKEN.strip() == "":
        print("[TELEGRAM] Token non configurato o default. Polling disattivato.")
        return
        
    print("[TELEGRAM] Avvio del bot in modalità polling con controllo temporale...")
    
    # Rileva il timestamp di avvio del server (in UTC per consistenza con le API di Telegram)
    start_time = datetime.datetime.now(datetime.timezone.utc).timestamp()
    offset = 0
    
    async with httpx.AsyncClient(timeout=10.0) as client:
        while True:
            try:
                url = f"https://api.telegram.org/bot{BOT_TOKEN}/getUpdates"
                params = {"offset": offset, "timeout": 5}
                response = await client.get(url, params=params)
                if response.status_code == 200:
                    data = response.json()
                    updates = data.get("result", [])
                    for update in updates:
                        offset = update["update_id"] + 1
                        message = update.get("message")
                        if not message:
                            continue
                        
                        # Controllo temporale intelligente sui messaggi pendenti
                        msg_date = message.get("date")
                        if msg_date and msg_date < (start_time - 30):
                            # Il messaggio è vecchio di oltre 30 secondi rispetto all'avvio del server: ignorato
                            continue
                            
                        chat = message.get("chat")
                        chat_id = chat.get("id")
                        text = message.get("text", "").strip()
                        
                        # Esegue la gestione dei messaggi in modo asincrono
                        await handle_telegram_message(chat_id, text)
                else:
                    print(f"[TELEGRAM] Errore getUpdates: status {response.status_code}")
            except Exception as e:
                print(f"[TELEGRAM] Eccezione nel loop del polling Telegram: {e}")
            
            await asyncio.sleep(2)

async def notify_users_via_telegram(db, neonate, alert_msg: str, severity: str):
    """Invia notifiche via Telegram a tutti gli utenti associati al neonato (Genitore ed eventuale Medico)."""
    # Cerca il genitore
    parent_chat_id = None
    if neonate.parent_id:
        res = await db.execute(
            select(models.UserModel.telegram_chat_id).where(models.UserModel.id == neonate.parent_id)
        )
        parent_chat_id = res.scalar_one_or_none()
        
    # Cerca il medico
    doctor_chat_id = None
    if neonate.doctor_id:
        res = await db.execute(
            select(models.UserModel.telegram_chat_id).where(models.UserModel.id == neonate.doctor_id)
        )
        doctor_chat_id = res.scalar_one_or_none()
        
    chat_ids = list(set([cid for cid in [parent_chat_id, doctor_chat_id] if cid]))
    
    if not chat_ids:
        print(f"[TELEGRAM] Nessun utente associato con chat_id abilitato per il neonato {neonate.first_name} {neonate.last_name}")
        return
        
    emoji = "🔴" if severity.lower() == "critical" else "⚠️"
    message = (
        f"{emoji} <b>ALLERTA BABYGUARD ({severity.upper()})</b> {emoji}\n\n"
        f"<b>Neonato:</b> {neonate.first_name} {neonate.last_name}\n"
        f"<b>Messaggio:</b> {alert_msg}\n"
        f"<b>Ora:</b> {datetime.datetime.now().strftime('%H:%M:%S del %d/%m/%Y')}"
    )
    
    for chat_id in chat_ids:
        print(f"[TELEGRAM] Invio allerta a chat_id: {chat_id}")
        await send_telegram_message_direct(int(chat_id), message)
