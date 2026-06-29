import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  SafeAreaView,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  ActivityIndicator,
  Alert,
  Modal,
  StatusBar,
  Platform,
  KeyboardAvoidingView,
  Linking,
  Image,
  Pressable,
  Animated
} from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import Slider from '@react-native-community/slider';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// --- JWT TOKEN DECODER FOR REACT NATIVE ---
function decodeBase64(input: string): string {
  // Converte Base64Url in Base64 standard
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  // Aggiunge il padding se mancante
  const pad = base64.length % 4;
  if (pad === 2) {
    base64 += '==';
  } else if (pad === 3) {
    base64 += '=';
  }

  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let str = base64.replace(/=+$/, '');
  let output = '';
  for (let bc = 0, bs = 0, idx = 0; idx < str.length; idx++) {
    const char = str.charAt(idx);
    const charIndex = chars.indexOf(char);
    if (charIndex === -1) continue;
    bs = bc % 4 ? bs * 64 + charIndex : charIndex;
    if (bc++ % 4) {
      output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6)));
    }
  }
  return output;
}

async function registerForPushNotificationsAsync() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    });
  }

  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') {
    console.warn("Permesso notifiche non concesso");
  }
  return null;
}

// --- TYPES & INTERFACES ---
interface Neonate {
  id: number;
  first_name: string;
  last_name: string;
  birth_date: string;
  gender: string;
  device_id: string;
  age?: string | number;
  height?: string | number;
  weight?: string | number;
  gestational_age_weeks?: number;
  doctor_id?: number;
}

interface Thresholds {
  id?: number;
  neonate_id?: number;
  hr_min: number;
  hr_max: number;
  br_min: number;
  br_max: number;
  temp_min: number;
  temp_max: number;
}

interface AlertLog {
  id: number;
  neonate_id: number;
  type: string;
  message: string;
  severity: string;
  timestamp: string;
  is_resolved: boolean;
}

interface LiveData {
  heartrate?: number;
  temperature?: number;
  breathrate?: number;
  orientation?: number;
  battery_level?: number;
  battery_charging?: number;
}

interface HistoryEntry {
  value: number | string;
  time: string;
}

interface Doctor {
  id: number;
  username: string;
  email: string;
  role: string;
  first_name?: string;
  last_name?: string;
  medical_id?: string;
}

export default function App() {
  // Connection Config
  const getDefaultIp = () => {
    if (process.env.EXPO_PUBLIC_API_URL) {
      const match = process.env.EXPO_PUBLIC_API_URL.match(/https?:\/\/([^:/]+)/);
      if (match && match[1]) {
        return match[1];
      }
    }
    return '192.168.1.58';
  };

  const [backendIp, setBackendIp] = useState(getDefaultIp());
  const [showConfig, setShowConfig] = useState(false);

  // Auth State
  const [token, setToken] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null); // 'parent', 'doctor'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [selectedRole, setSelectedRole] = useState<'parent' | 'doctor'>('parent');
  const [medicalId, setMedicalId] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);

  // Form Validation State
  const [validationErrors, setValidationErrors] = useState<{ [key: string]: string }>({});
  const [babyErrors, setBabyErrors] = useState<{ [key: string]: string }>({});

  // App Core State
  const [neonates, setNeonates] = useState<Neonate[]>([]);
  const [selectedNeonate, setSelectedNeonate] = useState<Neonate | null>(null);
  const [thresholds, setThresholds] = useState<Thresholds | null>(null);
  const [alerts, setAlerts] = useState<AlertLog[]>([]);
  const [ahiData, setAhiData] = useState<{ ahi_index: number; apnea_count: number; hours: number; status: string } | null>(null);
  const [liveData, setLiveData] = useState<LiveData>({});
  const [hrHistory, setHrHistory] = useState<HistoryEntry[]>([]);
  const [tempHistory, setTempHistory] = useState<HistoryEntry[]>([]);
  const [brHistory, setBrHistory] = useState<HistoryEntry[]>([]);
  const [posHistory, setPosHistory] = useState<HistoryEntry[]>([]);

  const [flippedHr, setFlippedHr] = useState(false);
  const [flippedTemp, setFlippedTemp] = useState(false);
  const [flippedBr, setFlippedBr] = useState(false);
  const [flippedPos, setFlippedPos] = useState(false);
  const [parentScrollEnabled, setParentScrollEnabled] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const flipAnimHr = useRef(new Animated.Value(0)).current;
  const flipAnimTemp = useRef(new Animated.Value(0)).current;
  const flipAnimBr = useRef(new Animated.Value(0)).current;
  const flipAnimPos = useRef(new Animated.Value(0)).current;
  const [chartSamples, setChartSamples] = useState<number[]>([]);
  const [lastDataTimestamp, setLastDataTimestamp] = useState<number>(0);
  const lastDataTimestampRef = useRef<number>(0);
  const [shirtConnected, setShirtConnected] = useState<boolean>(false);
  const [rawEcgBuffer, setRawEcgBuffer] = useState<number[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [associateDeviceId, setAssociateDeviceId] = useState('');

  // Telegram Integration State
  const [telegramAssociated, setTelegramAssociated] = useState<boolean>(false);
  const [telegramChatId, setTelegramChatId] = useState<string | null>(null);
  const [telegramCode, setTelegramCode] = useState<string | null>(null);
  const [legendExpanded, setLegendExpanded] = useState(false);
  const [telegramLoading, setTelegramLoading] = useState<boolean>(false);
  const [telegramBotUsername, setTelegramBotUsername] = useState<string>('BabyGuardNotifyBot');

  // Doctor Modals & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [editThresholdsModal, setEditThresholdsModal] = useState(false);
  const [tempHrMin, setTempHrMin] = useState('');
  const [tempHrMax, setTempHrMax] = useState('');
  const [tempTempMin, setTempTempMin] = useState('');
  const [tempTempMax, setTempTempMax] = useState('');
  const [tempBrMin, setTempBrMin] = useState('');
  const [tempBrMax, setTempBrMax] = useState('');

  // Parent Create Baby Form
  const [showAddBabyModal, setShowAddBabyModal] = useState(false);
  const [showEditBabyModal, setShowEditBabyModal] = useState(false);
  const [babyFirstName, setBabyFirstName] = useState('');
  const [babyLastName, setBabyLastName] = useState('');
  const [babyBirthDate, setBabyBirthDate] = useState('2026-06-19T00:00:00Z');
  const [babyGestationalAge, setBabyGestationalAge] = useState('40.0');
  const [babyGender, setBabyGender] = useState('M');
  const [babyDeviceId, setBabyDeviceId] = useState('');
  const [babyHeight, setBabyHeight] = useState('');
  const [babyWeight, setBabyWeight] = useState('');
  const [babyAge, setBabyAge] = useState('');
  const [doctorsList, setDoctorsList] = useState<Doctor[]>([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState<number | null>(null);
  const [babyLoading, setBabyLoading] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);

  // Derived API URLs
  const API_URL = `http://${backendIp}:8000`;
  const WS_URL = `ws://${backendIp}:8000/ws`;

  // --- HELPERS ---
  const getErrorMessage = async (response: any, defaultMsg: string): Promise<string> => {
    try {
      const text = await response.text();
      try {
        const data = JSON.parse(text);
        if (data && typeof data === 'object') {
          if (data.detail) {
            if (typeof data.detail === 'string') {
              return data.detail;
            } else if (Array.isArray(data.detail)) {
              return data.detail.map((d: any) => d.msg || JSON.stringify(d)).join('\n');
            }
            return JSON.stringify(data.detail);
          }
        }
        return text || defaultMsg;
      } catch (e) {
        return text || defaultMsg;
      }
    } catch (tErr) {
      return defaultMsg;
    }
  };

  // --- VALIDATION FUNCTIONS ---
  const validateRegistrationForm = () => {
    const errs: { [key: string]: string } = {};

    if (!username.trim()) {
      errs.username = 'Lo username è obbligatorio.';
    } else if (username.trim().length < 4 || username.trim().length > 20) {
      errs.username = 'Lo username deve essere compreso tra 4 e 20 caratteri.';
    } else if (!/^[a-zA-Z0-9_]+$/.test(username.trim())) {
      errs.username = 'Lo username può contenere solo lettere, numeri e underscore.';
    }

    if (!email.trim()) {
      errs.email = "L'email è obbligatoria.";
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        errs.email = 'Inserisci un indirizzo email valido (es. nome@dominio.com).';
      }
    }

    if (!firstName.trim()) {
      errs.firstName = 'Il nome è obbligatorio.';
    } else if (firstName.trim().length < 2) {
      errs.firstName = 'Il nome deve contenere almeno 2 caratteri.';
    } else if (!/^[a-zA-Z\sàèìòùèéòóùúáíóúüñÑíìîï]+$/.test(firstName.trim())) {
      errs.firstName = 'Il nome può contenere solo lettere e spazi.';
    }

    if (!lastName.trim()) {
      errs.lastName = 'Il cognome è obbligatorio.';
    } else if (lastName.trim().length < 2) {
      errs.lastName = 'Il cognome deve contenere almeno 2 caratteri.';
    } else if (!/^[a-zA-Z\sàèìòùèéòóùúáíóúüñÑíìîï]+$/.test(lastName.trim())) {
      errs.lastName = 'Il cognome può contenere solo lettere e spazi.';
    }

    if (!password) {
      errs.password = 'La password è obbligatoria.';
    } else if (password.length < 6) {
      errs.password = 'La password deve contenere almeno 6 caratteri.';
    } else if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
      errs.password = 'Deve contenere almeno una maiuscola, una minuscola e un numero.';
    }

    if (!confirmPassword) {
      errs.confirmPassword = 'La conferma della password è obbligatoria.';
    } else if (password !== confirmPassword) {
      errs.confirmPassword = 'Le password inserite non coincidono.';
    }

    if (selectedRole === 'doctor') {
      if (!medicalId.trim()) {
        errs.medicalId = 'Il Codice Identificativo Medico è obbligatorio.';
      } else {
        const medicalIdRegex = /^[A-Z]{2}-\d{5}$/;
        if (!medicalIdRegex.test(medicalId.trim())) {
          errs.medicalId = 'Deve essere nel formato XX-YYYYY (es. RM-45928).';
        }
      }
    }

    setValidationErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const validateLoginForm = () => {
    const errs: { [key: string]: string } = {};
    if (!username.trim()) {
      errs.username = 'Lo username è obbligatorio.';
    }
    if (!password) {
      errs.password = 'La password è obbligatoria.';
    }
    setValidationErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // --- LOGIN & REGISTER ---
  const handleAuth = async () => {
    setValidationErrors({}); // Clear old errors

    if (isRegistering) {
      if (!validateRegistrationForm()) {
        Alert.alert('Errore di Validazione', 'Per favore, correggi gli errori evidenziati nel modulo.');
        return;
      }
    } else {
      if (!validateLoginForm()) {
        Alert.alert('Errore di Validazione', 'Username e Password sono obbligatori.');
        return;
      }
    }

    setAuthLoading(true);
    try {
      if (isRegistering) {
        // Register User
        const registerResponse = await fetch(`${API_URL}/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username,
            email,
            password,
            role: selectedRole,
            first_name: firstName,
            last_name: lastName,
            medical_id: selectedRole === 'doctor' ? medicalId : null
          })
        });

        if (!registerResponse.ok) {
          const errMsg = await getErrorMessage(registerResponse, 'Registrazione fallita');
          throw new Error(errMsg);
        }
        Alert.alert('Successo', 'Account creato con successo. Ora puoi effettuare il login!');
        setIsRegistering(false);
        setValidationErrors({});
      } else {
        // Login
        const loginData = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
        const response = await fetch(`${API_URL}/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: loginData
        });

        if (!response.ok) {
          const errMsg = await getErrorMessage(response, 'Credenziali non valide o Server non raggiungibile');
          throw new Error(errMsg);
        }

        let data;
        try {
          data = await response.json();
        } catch (jsonErr) {
          throw new Error('Risposta del server non valida.');
        }
        setToken(data.access_token);
        setValidationErrors({});

        // Decode Token for role
        try {
          const payloadBase64 = data.access_token.split('.')[1];
          const decodedString = decodeBase64(payloadBase64);
          console.log("DECODED STRING:", decodedString);
          const decodedPayload = JSON.parse(decodedString);
          console.log("DECODED PAYLOAD:", decodedPayload);
          setRole(decodedPayload.role || 'parent');
        } catch (e: any) {
          console.error("Error decoding token payload:", e);
          Alert.alert('Errore Decodifica Token', e.message || 'Errore sconosciuto');
          setRole('parent'); // fallback
        }
      }
    } catch (error: any) {
      Alert.alert('Errore', error.message || 'Qualcosa è andato storto.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    setToken(null);
    setRole(null);
    setUsername('');
    setPassword('');
    setConfirmPassword('');
    setEmail('');
    setFirstName('');
    setLastName('');
    setMedicalId('');
    setNeonates([]);
    setSelectedNeonate(null);
    setThresholds(null);
    setAlerts([]);
    setAhiData(null);
    setLiveData({});
    setChartSamples([]);
    setHrHistory([]);
    setTempHistory([]);
    setBrHistory([]);
    setPosHistory([]);
    setFlippedHr(false);
    setFlippedTemp(false);
    setFlippedBr(false);
    setFlippedPos(false);
    flipAnimHr.setValue(0);
    flipAnimTemp.setValue(0);
    flipAnimBr.setValue(0);
    flipAnimPos.setValue(0);
    setLastDataTimestamp(0);
    lastDataTimestampRef.current = 0;
    setShirtConnected(false);
    if (wsRef.current) {
      wsRef.current.close();
    }
  };

  const handleOpenDashboard = async () => {
    if (!token) return;
    try {
      const response = await fetch(`${API_URL}/api/doctors/dashboard-url`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        const fullUrl = `${API_URL}${data.url}`;
        const supported = await Linking.canOpenURL(fullUrl);
        if (supported) {
          await Linking.openURL(fullUrl);
        } else {
          Alert.alert('Errore', 'Impossibile aprire il browser per questo URL: ' + fullUrl);
        }
      } else {
        const errData = await response.json();
        Alert.alert('Errore', errData.detail || 'Impossibile caricare il link della dashboard.');
      }
    } catch (error) {
      Alert.alert('Errore', 'Connessione al server non riuscita.');
    }
  };

  // --- REGISTER PUSH NOTIFICATIONS ---
  useEffect(() => {
    if (!token) return;

    const setupPushNotifications = async () => {
      try {
        console.log("INIT PUSH START");
        const pushToken = await registerForPushNotificationsAsync();
        console.log("TOKEN:", pushToken);
        if (pushToken) {
          // Send push token to backend matching professor's route and schema
          const response = await fetch(`${API_URL}/register-token`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ token: pushToken })
          });
          if (response.ok) {
            const data = await response.json();
            console.log("REGISTER RESPONSE:", data);
          } else {
            const errMsg = await getErrorMessage(response, 'Impossibile registrare il token push');
            console.error("ERRORE REGISTRAZIONE TOKEN PUSH:", errMsg);
          }
        } else {
          console.log("Notifiche push non attive (nessun token generato).");
        }
      } catch (err: any) {
        console.error("ERRORE INIT PUSH:", err);
        Alert.alert("Errore push", err.message);
      }
    };

    setupPushNotifications();
  }, [token, backendIp]);

  // --- FETCH NEONATES AND DOCTORS ---
  useEffect(() => {
    if (!token) return;

    const fetchNeonates = async () => {
      try {
        const response = await fetch(`${API_URL}/neonates`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
          const data = await response.json();
          setNeonates(data);
          if (data.length > 0) {
            setSelectedNeonate(data[0]);
          } else {
            setSelectedNeonate(null);
          }
        }
      } catch (e) {
        console.error('Fetch neonates error:', e);
      }
    };

    const fetchDoctors = async () => {
      try {
        const response = await fetch(`${API_URL}/doctors`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
          const data = await response.json();
          setDoctorsList(data);
          if (data.length > 0) {
            setSelectedDoctorId(data[0].id);
          }
        }
      } catch (e) {
        console.error('Fetch doctors list error:', e);
      }
    };

    fetchNeonates();
    fetchDoctors();
    fetchTelegramStatus(token);
  }, [token, backendIp]);

  // --- REUSABLE DATA FETCHERS ---
  const fetchAhi = async (neonateId: number, currentToken: string) => {
    try {
      const ahiResp = await fetch(`${API_URL}/neonates/${neonateId}/ahi?range_start=-24h`, {
        headers: { 'Authorization': `Bearer ${currentToken}` }
      });
      if (ahiResp.ok) {
        const aAhiData = await ahiResp.json();
        setAhiData(aAhiData);
      }
    } catch (e) {
      console.error('Fetch AHI error:', e);
    }
  };

  const fetchAlerts = async (neonateId: number, currentToken: string) => {
    try {
      const aResp = await fetch(`${API_URL}/neonates/${neonateId}/alerts`, {
        headers: { 'Authorization': `Bearer ${currentToken}` }
      });
      if (aResp.ok) {
        const aData = await aResp.json();
        setAlerts(aData);
      }
    } catch (e) {
      console.error('Fetch alerts error:', e);
    }
  };

  const fetchTelegramStatus = async (currentToken: string) => {
    if (!currentToken) return;
    try {
      setTelegramLoading(true);
      const resp = await fetch(`${API_URL}/api/telegram/status`, {
        headers: { 'Authorization': `Bearer ${currentToken}` }
      });
      if (resp.ok) {
        const data = await resp.json();
        setTelegramAssociated(data.associated);
        setTelegramChatId(data.chat_id);
      }
    } catch (e) {
      console.error('Fetch Telegram status error:', e);
    } finally {
      setTelegramLoading(false);
    }
  };

  const handleGenerateTelegramCode = async () => {
    if (!token) return;
    try {
      setTelegramLoading(true);
      const resp = await fetch(`${API_URL}/api/telegram/generate-code`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (resp.ok) {
        const data = await resp.json();
        setTelegramCode(data.code);
        if (data.bot_username) {
          setTelegramBotUsername(data.bot_username);
        }
      } else {
        Alert.alert('Errore', 'Impossibile generare il codice Telegram.');
      }
    } catch (e) {
      console.error('Generate Telegram code error:', e);
      Alert.alert('Errore', 'Errore di connessione al server.');
    } finally {
      setTelegramLoading(false);
    }
  };

  const handleUnlinkTelegram = async () => {
    if (!token) return;
    try {
      setTelegramLoading(true);
      const resp = await fetch(`${API_URL}/api/telegram/unlink`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (resp.ok) {
        setTelegramAssociated(false);
        setTelegramChatId(null);
        setTelegramCode(null);
        Alert.alert('Successo', 'Associazione Telegram rimossa.');
      } else {
        Alert.alert('Errore', 'Impossibile scollegare Telegram.');
      }
    } catch (e) {
      console.error('Unlink Telegram error:', e);
      Alert.alert('Errore', 'Errore di connessione al server.');
    } finally {
      setTelegramLoading(false);
    }
  };

  // --- LOAD INITIAL THRESHOLDS, ALERTS, AHI ---
  useEffect(() => {
    if (!token || !selectedNeonate) return;

    const fetchThresholds = async () => {
      try {
        const tResp = await fetch(`${API_URL}/neonates/${selectedNeonate.id}/thresholds`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (tResp.ok) {
          const tData = await tResp.json();
          setThresholds(tData);
          setTempHrMin(String(tData.hr_min));
          setTempHrMax(String(tData.hr_max));
          setTempTempMin(String(tData.temp_min));
          setTempTempMax(String(tData.temp_max));
          setTempBrMin(String(tData.br_min));
          setTempBrMax(String(tData.br_max));
        }
      } catch (e) {
        console.error('Fetch thresholds error:', e);
      }
    };

    fetchThresholds();
    fetchAlerts(selectedNeonate.id, token);
    fetchAhi(selectedNeonate.id, token);

    setAhiData(null);
    setLiveData({});
    setChartSamples([]);
    setHrHistory([]);
    setTempHistory([]);
    setBrHistory([]);
    setPosHistory([]);
    setFlippedHr(false);
    setFlippedTemp(false);
    setFlippedBr(false);
    setFlippedPos(false);
    flipAnimHr.setValue(0);
    flipAnimTemp.setValue(0);
    flipAnimBr.setValue(0);
    flipAnimPos.setValue(0);
    setLastDataTimestamp(0);
    lastDataTimestampRef.current = 0;
    setShirtConnected(false);
  }, [selectedNeonate, token, backendIp]);

  // --- PERIODIC DATA POLL (Alerts & AHI) ---
  useEffect(() => {
    if (!token || !selectedNeonate) return;

    const interval = setInterval(() => {
      fetchAhi(selectedNeonate.id, token);
      fetchAlerts(selectedNeonate.id, token);
    }, 10000); // Poll every 10 seconds

    return () => clearInterval(interval);
  }, [selectedNeonate, token, backendIp]);

  // --- WEBSOCKET CONNECTION ---
  useEffect(() => {
    if (!token || !selectedNeonate) return;

    let ws: WebSocket | null = null;
    let reconnectTimeout: any = null;
    let isMounted = true;

    const connect = () => {
      if (!isMounted) return;

      console.log('Tentativo di connessione WebSocket...');
      ws = new WebSocket(`${WS_URL}/${selectedNeonate.id}`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (isMounted) {
          console.log('WebSocket connesso con successo.');
          setWsConnected(true);
        }
      };

      ws.onmessage = (event) => {
        if (!isMounted) return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.event === 'alert') {
            if (msg.neonate_id === selectedNeonate.id) {
              setAlerts((prev) => {
                const exists = prev.some((a) => a.id === msg.alert.id);
                if (exists) {
                  return prev.map((a) => a.id === msg.alert.id ? msg.alert : a);
                }
                return [msg.alert, ...prev];
              });
              fetchAhi(selectedNeonate.id, token);

              // Notifica locale immediata
              Notifications.scheduleNotificationAsync({
                content: {
                  title: `🚨 Allerta BabyGuard - ${msg.alert.type.toUpperCase()}`,
                  body: `${selectedNeonate.first_name} ${selectedNeonate.last_name}: ${msg.alert.message}`,
                  sound: true,
                  priority: Notifications.AndroidNotificationPriority.MAX,
                },
                trigger: null,
              }).catch((err) => console.error("Errore notifica locale:", err));
            }
          } else if (msg.event === 'alert_resolved') {
            if (msg.neonate_id === selectedNeonate.id) {
              setAlerts((prev) =>
                prev.map(a => a.id === msg.alert_id ? { ...a, is_resolved: true } : a)
              );
              fetchAhi(selectedNeonate.id, token);
            }
          } else if (msg.device_id && selectedNeonate.device_id && msg.device_id.trim().toLowerCase() === selectedNeonate.device_id.trim().toLowerCase()) {
            lastDataTimestampRef.current = Date.now();
            setLastDataTimestamp(Date.now());
            setShirtConnected(true);
            const type = msg.type ? msg.type.toUpperCase() : '';
            const payload = msg.data;

            if (type === 'R2R' || type === 'ECG') {
              const hr = payload.heartrate;
              if (hr && hr > 0) {
                setLiveData((prev) => {
                  const prevHr = prev.heartrate;
                  // Exponential Moving Average filter (alpha = 0.2) to smooth heartrate transitions
                  const smoothHr = prevHr && prevHr > 0 ? Math.round(0.2 * hr + 0.8 * prevHr) : hr;
                  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                  setHrHistory((prevHistory) => [...prevHistory.slice(-19), { value: smoothHr, time: timeStr }]);
                  return { ...prev, heartrate: smoothHr };
                });
                setChartSamples((prevSamples) => {
                  const prevHr = prevSamples[prevSamples.length - 1];
                  const smoothHr = prevHr && prevHr > 0 ? Math.round(0.2 * hr + 0.8 * prevHr) : hr;
                  return [...prevSamples.slice(-15), smoothHr];
                });
              }
              // Salvataggio dei campioni ECG per il grafico real-time
              if (type === 'ECG' && payload.samples && Array.isArray(payload.samples)) {
                const newSamples = payload.samples;
                setRawEcgBuffer((prev) => {
                  // Mantiene gli ultimi 150 campioni per una visualizzazione ottimale a schermo
                  const combined = [...prev, ...newSamples];
                  return combined.slice(-150);
                });
              }
            } else if (type === 'TEMPERATURE') {
              let temp = payload.temperature;
              if (temp !== undefined && temp > 0 && temp <= 60) {
                if (temp > 10000) temp = temp / 1000.0;
                else if (temp > 1000) temp = temp / 100.0;

                setLiveData((prev) => {
                  const prevTemp = prev.temperature;
                  // EMA filter (alpha = 0.15) for smooth temperature changes
                  const smoothTemp = prevTemp && prevTemp > 0 ? Number((0.15 * temp + 0.85 * prevTemp).toFixed(2)) : temp;
                  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                  setTempHistory((prevHistory) => [...prevHistory.slice(-19), { value: smoothTemp, time: timeStr }]);
                  return { ...prev, temperature: smoothTemp };
                });
              }
            } else if (type === 'STRAINGAUGES_MIXED' || type === 'BREATH_ANNOTATION') {
              const br = payload.breathrate;
              if (br && br > 0) {
                setLiveData((prev) => {
                  const prevBr = prev.breathrate;
                  // EMA filter (alpha = 0.2) to smooth respiratory rates
                  const smoothBr = prevBr && prevBr > 0 ? Math.round(0.2 * br + 0.8 * prevBr) : br;
                  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                  setBrHistory((prevHistory) => [...prevHistory.slice(-19), { value: smoothBr, time: timeStr }]);
                  return { ...prev, breathrate: smoothBr };
                });
              }
            } else if (type === 'BABY_ORIENTATION' || type === 'ACC_GYRO') {
              const orientation = payload.orientation;
              if (orientation !== undefined) {
                setLiveData((prev) => {
                  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                  setPosHistory((prevHistory) => [...prevHistory.slice(-19), { value: getOrientationText(orientation), time: timeStr }]);
                  return { ...prev, orientation };
                });
              }
            } else if (type === 'BATTERY_INFO') {
              const soc = payload.state_of_charge;
              const charging = payload.charging;
              if (soc !== undefined) {
                setLiveData((prev) => ({ ...prev, battery_level: soc, battery_charging: charging }));
              }
            }
          }
        } catch (err) {
          console.error('WS parse error:', err);
        }
      };

      ws.onerror = (e) => {
        console.warn('WS error:', e);
        if (isMounted) {
          setWsConnected(false);
        }
      };

      ws.onclose = () => {
        console.warn('WS connessione chiusa. Tentativo di riconnessione tra 3 secondi...');
        if (isMounted) {
          setWsConnected(false);
          reconnectTimeout = setTimeout(() => {
            connect();
          }, 3000);
        }
      };
    };

    connect();

    return () => {
      isMounted = false;
      if (ws) {
        ws.close();
      }
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
    };
  }, [selectedNeonate, token, backendIp]);

  // --- TELEMETRY SIGNAL WATCHDOG TIMER ---
  useEffect(() => {
    if (!wsConnected) {
      setShirtConnected(false);
      return;
    }
    const interval = setInterval(() => {
      const lastTs = lastDataTimestampRef.current;
      if (lastTs > 0 && Date.now() - lastTs > 6000) {
        setShirtConnected(false);
        setLiveData({});
        setRawEcgBuffer([]);
        setHrHistory([]);
        setTempHistory([]);
        setBrHistory([]);
        setPosHistory([]);
        setFlippedHr(false);
        setFlippedTemp(false);
        setFlippedBr(false);
        setFlippedPos(false);
        flipAnimHr.setValue(0);
        flipAnimTemp.setValue(0);
        flipAnimBr.setValue(0);
        flipAnimPos.setValue(0);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [wsConnected]);

  // --- RESOLVE ALERT (Acknowledge) ---
  const handleResolveAlert = async (alertId: number) => {
    if (!token) return;

    try {
      const response = await fetch(`${API_URL}/alerts/${alertId}/resolve`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const updatedAlert = await response.json();
        setAlerts((prev) =>
          prev.map((a) => (a.id === alertId ? updatedAlert : a))
        );
        if (selectedNeonate) {
          fetchAhi(selectedNeonate.id, token);
        }
      }
    } catch (e) {
      console.error('Resolve alert error:', e);
    }
  };

  // --- ASSOCIATE DEVICE ---
  const handleAssociateDevice = async (neonateId: number) => {
    if (!token || !associateDeviceId) {
      Alert.alert('Errore', 'Inserisci un ID Maglietta valido.');
      return;
    }

    const cleanDeviceId = associateDeviceId.trim().toLowerCase();

    try {
      const response = await fetch(`${API_URL}/neonates/${neonateId}/device`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ device_id: cleanDeviceId })
      });

      if (response.ok) {
        const updatedNeonate = await response.json();
        setNeonates((prev) => prev.map(n => n.id === neonateId ? updatedNeonate : n));
        setSelectedNeonate(updatedNeonate);
        setAssociateDeviceId('');
        Alert.alert('Successo', 'Smart Shirt associata correttamente!');
      } else {
        const errMsg = await getErrorMessage(response, 'Impossibile associare il dispositivo');
        throw new Error(errMsg);
      }
    } catch (e: any) {
      Alert.alert('Errore', e.message);
    }
  };

  // --- DELETE BABY PROFILE ---
  const handleDeleteBaby = async (neonateId: number) => {
    if (!token) return;

    try {
      const response = await fetch(`${API_URL}/neonates/${neonateId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        setNeonates((prev) => {
          const filtered = prev.filter((n) => n.id !== neonateId);
          if (selectedNeonate?.id === neonateId) {
            if (filtered.length > 0) {
              setSelectedNeonate(filtered[0]);
            } else {
              setSelectedNeonate(null);
            }
          }
          return filtered;
        });
        setLiveData({});
        setChartSamples([]);
        Alert.alert('Successo', 'Profilo del bambino eliminato definitivamente.');
      } else {
        const errMsg = await getErrorMessage(response, 'Impossibile eliminare il profilo');
        throw new Error(errMsg);
      }
    } catch (e: any) {
      Alert.alert('Errore', e.message);
    }
  };

  // --- DISSOCIATE DEVICE ---
  const handleDissociateDevice = async (neonateId: number) => {
    if (!token) return;

    const targetBaby = neonates.find(n => n.id === neonateId);
    if (!targetBaby) return;

    if (!targetBaby.device_id) {
      // Direct deletion prompt if no device associated
      Alert.alert(
        'Conferma Eliminazione',
        'Sei sicuro di voler eliminare definitivamente il profilo di questo bambino? Tutti i dati associati andranno persi.',
        [
          { text: 'Annulla', style: 'cancel' },
          {
            text: 'Elimina',
            style: 'destructive',
            onPress: () => handleDeleteBaby(neonateId)
          }
        ]
      );
      return;
    }

    Alert.alert(
      'Gestione Smart Shirt e Profilo',
      'Cosa desideri fare con il profilo del bambino e il dispositivo associato?',
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Solo Dissocia Maglietta',
          style: 'default',
          onPress: async () => {
            try {
              const response = await fetch(`${API_URL}/neonates/${neonateId}/device`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
              });

              if (response.ok) {
                const updatedNeonate = await response.json();
                setNeonates((prev) => prev.map(n => n.id === neonateId ? updatedNeonate : n));
                setSelectedNeonate(updatedNeonate);
                setLiveData({});
                setChartSamples([]);
                Alert.alert('Successo', 'Smart Shirt dissociata correttamente.');
              } else {
                const errMsg = await getErrorMessage(response, 'Impossibile dissociare il dispositivo');
                throw new Error(errMsg);
              }
            } catch (e: any) {
              Alert.alert('Errore', e.message);
            }
          }
        },
        {
          text: 'Elimina Profilo Bambino',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Conferma Eliminazione Definitiva',
              'Sei sicuro di voler eliminare per sempre il profilo di questo bambino? Tutti i dati associati andranno persi.',
              [
                { text: 'Annulla', style: 'cancel' },
                {
                  text: 'Elimina',
                  style: 'destructive',
                  onPress: () => handleDeleteBaby(neonateId)
                }
              ]
            );
          }
        }
      ]
    );
  };

  const validateBabyForm = () => {
    const errs: { [key: string]: string } = {};
    if (!babyFirstName.trim()) {
      errs.firstName = 'Il nome è obbligatorio.';
    } else if (babyFirstName.trim().length < 2) {
      errs.firstName = 'Il nome deve contenere almeno 2 caratteri.';
    } else if (!/^[a-zA-Z\sàèìòùèéòóùúáíóúüñÑíìîï]+$/.test(babyFirstName.trim())) {
      errs.firstName = 'Il nome può contenere solo lettere.';
    }

    if (!babyLastName.trim()) {
      errs.lastName = 'Il cognome è obbligatorio.';
    } else if (babyLastName.trim().length < 2) {
      errs.lastName = 'Il cognome deve contenere almeno 2 caratteri.';
    } else if (!/^[a-zA-Z\sàèìòùèéòóùúáíóúüñÑíìîï]+$/.test(babyLastName.trim())) {
      errs.lastName = 'Il cognome può contenere solo lettere.';
    }

    if (!babyDeviceId.trim()) {
      errs.deviceId = "L'ID maglietta è obbligatorio.";
    }

    if (!selectedDoctorId) {
      errs.doctorId = 'Seleziona un pediatra di riferimento.';
    }

    if (babyAge.trim()) {
      const ageVal = parseInt(babyAge.trim());
      if (isNaN(ageVal) || ageVal < 0 || ageVal > 120) {
        errs.age = "L'età deve essere un numero valido tra 0 e 120 mesi.";
      }
    }

    if (babyHeight.trim()) {
      const heightVal = parseFloat(babyHeight.trim());
      if (isNaN(heightVal) || heightVal <= 0 || heightVal > 150) {
        errs.height = "L'altezza deve essere un numero valido tra 1 e 150 cm.";
      }
    }

    if (babyWeight.trim()) {
      const weightVal = parseFloat(babyWeight.trim());
      if (isNaN(weightVal) || weightVal <= 0 || weightVal > 50) {
        errs.weight = "Il peso deve essere un numero valido tra 0.1 e 50 kg.";
      }
    }

    if (babyGestationalAge.trim()) {
      const gAge = parseFloat(babyGestationalAge.trim());
      if (isNaN(gAge) || gAge < 20 || gAge > 46) {
        errs.gestationalAge = "L'età gestazionale deve essere tra 20 e 46 settimane.";
      }
    }

    setBabyErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // --- ADD NEONATE (Parent Only) ---
  const handleAddBaby = async () => {
    setBabyErrors({});
    if (!validateBabyForm()) {
      Alert.alert('Errore di Validazione', 'Per favore, compila correttamente tutti i campi.');
      return;
    }

    const cleanFirstName = babyFirstName.trim();
    const cleanLastName = babyLastName.trim();
    const cleanDeviceId = babyDeviceId.trim().toLowerCase();

    // Calcola a ritroso la data di nascita a partire dall'età in mesi inserita dall'utente
    const ageMonths = babyAge.trim() ? parseInt(babyAge.trim()) : 0;
    const computedBirthDate = new Date();
    computedBirthDate.setMonth(computedBirthDate.getMonth() - ageMonths);

    setBabyLoading(true);
    try {
      const response = await fetch(`${API_URL}/neonates`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          first_name: cleanFirstName,
          last_name: cleanLastName,
          birth_date: computedBirthDate.toISOString(),
          gender: babyGender,
          device_id: cleanDeviceId,
          doctor_id: selectedDoctorId,
          height: babyHeight.trim() ? parseFloat(babyHeight.trim()) : null,
          weight: babyWeight.trim() ? parseFloat(babyWeight.trim()) : null,
          age: babyAge.trim() ? parseInt(babyAge.trim()) : null,
          gestational_age_weeks: babyGestationalAge.trim() ? parseFloat(babyGestationalAge.trim()) : null
        })
      });

      if (response.ok) {
        const newNeonate = await response.json();
        setNeonates((prev) => [...prev, newNeonate]);
        setSelectedNeonate(newNeonate);
        Alert.alert('Successo', 'Bambino e Smart Shirt registrati correttamente!');
        setShowAddBabyModal(false);
        // Clear fields
        setBabyFirstName('');
        setBabyLastName('');
        setBabyDeviceId('');
        setBabyGender('M');
        setBabyHeight('');
        setBabyWeight('');
        setBabyAge('');
        setBabyErrors({});
      } else {
        const errMsg = await getErrorMessage(response, 'Impossibile registrare il bambino.');
        throw new Error(errMsg);
      }
    } catch (e: any) {
      Alert.alert('Errore', e.message);
    } finally {
      setBabyLoading(false);
    }
  };

  const openEditBabyModal = () => {
    if (!selectedNeonate) return;
    setBabyFirstName(selectedNeonate.first_name);
    setBabyLastName(selectedNeonate.last_name);
    setBabyGender(selectedNeonate.gender || 'M');
    setBabyAge(selectedNeonate.age !== undefined && selectedNeonate.age !== null ? selectedNeonate.age.toString() : '');
    setBabyGestationalAge(selectedNeonate.gestational_age_weeks !== undefined && selectedNeonate.gestational_age_weeks !== null ? selectedNeonate.gestational_age_weeks.toString() : '40.0');
    setBabyHeight(selectedNeonate.height !== undefined && selectedNeonate.height !== null ? selectedNeonate.height.toString() : '');
    setBabyWeight(selectedNeonate.weight !== undefined && selectedNeonate.weight !== null ? selectedNeonate.weight.toString() : '');
    setSelectedDoctorId(selectedNeonate.doctor_id || null);
    setBabyErrors({});
    setShowEditBabyModal(true);
  };

  const handleUpdateBaby = async () => {
    if (!selectedNeonate || !token) return;

    const errs: any = {};
    if (!babyFirstName.trim()) errs.firstName = "Il nome è obbligatorio.";
    if (!babyLastName.trim()) errs.lastName = "Il cognome è obbligatorio.";
    if (babyAge.trim()) {
      const ageVal = parseInt(babyAge.trim());
      if (isNaN(ageVal) || ageVal < 0 || ageVal > 120) {
        errs.age = "L'età deve essere un numero valido tra 0 e 120 mesi.";
      }
    }
    if (babyGestationalAge.trim()) {
      const gAge = parseFloat(babyGestationalAge.trim());
      if (isNaN(gAge) || gAge < 20 || gAge > 46) {
        errs.gestationalAge = "L'età gestazionale deve essere tra 20 e 46 settimane.";
      }
    }
    if (babyHeight.trim() && isNaN(parseFloat(babyHeight.trim()))) errs.height = "Altezza non valida.";
    if (babyWeight.trim() && isNaN(parseFloat(babyWeight.trim()))) errs.weight = "Peso non valido.";
    if (!selectedDoctorId) errs.doctorId = "Seleziona un pediatra.";

    if (Object.keys(errs).length > 0) {
      setBabyErrors(errs);
      Alert.alert('Errore di Validazione', 'Per favore, compila correttamente tutti i campi.');
      return;
    }

    const cleanFirstName = babyFirstName.trim();
    const cleanLastName = babyLastName.trim();
    const ageMonths = babyAge.trim() ? parseInt(babyAge.trim()) : 0;
    const computedBirthDate = new Date();
    computedBirthDate.setMonth(computedBirthDate.getMonth() - ageMonths);

    setBabyLoading(true);
    try {
      const response = await fetch(`${API_URL}/neonates/${selectedNeonate.id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          first_name: cleanFirstName,
          last_name: cleanLastName,
          birth_date: computedBirthDate.toISOString(),
          gender: babyGender,
          height: babyHeight.trim() ? parseFloat(babyHeight.trim()) : null,
          weight: babyWeight.trim() ? parseFloat(babyWeight.trim()) : null,
          age: ageMonths,
          gestational_age_weeks: babyGestationalAge.trim() ? parseFloat(babyGestationalAge.trim()) : null,
          doctor_id: selectedDoctorId
        })
      });

      if (response.ok) {
        const updatedNeonate = await response.json();
        setNeonates((prev) => prev.map((n) => n.id === updatedNeonate.id ? updatedNeonate : n));
        setSelectedNeonate(updatedNeonate);
        Alert.alert('Successo', 'Profilo neonato aggiornato correttamente!');
        setShowEditBabyModal(false);
      } else {
        const errMsg = await getErrorMessage(response, 'Impossibile aggiornare il profilo.');
        throw new Error(errMsg);
      }
    } catch (e: any) {
      Alert.alert('Errore', e.message);
    } finally {
      setBabyLoading(false);
    }
  };

  // --- UPDATE THRESHOLDS (Doctor Only) ---
  const handleUpdateThresholds = async () => {
    if (!selectedNeonate || !token) return;

    const hrMin = parseInt(tempHrMin);
    const hrMax = parseInt(tempHrMax);
    const tempMin = parseFloat(tempTempMin);
    const tempMax = parseFloat(tempTempMax);
    const brMin = parseInt(tempBrMin);
    const brMax = parseInt(tempBrMax);

    // Dynamic thresholds values validation (UI-1.6)
    if (isNaN(hrMin) || isNaN(hrMax) || isNaN(tempMin) || isNaN(tempMax) || isNaN(brMin) || isNaN(brMax)) {
      Alert.alert('Errore', 'Inserisci dei numeri validi.');
      return;
    }

    if (hrMin >= hrMax) {
      Alert.alert('Errore', 'Frequenza cardiaca minima deve essere inferiore alla massima.');
      return;
    }

    if (tempMin >= tempMax) {
      Alert.alert('Errore', 'Temperatura minima deve essere inferiore alla massima.');
      return;
    }

    if (tempMin < 35.0 || tempMax > 42.0) {
      Alert.alert('Errore', 'Soglia temperatura non valida. Inserire un valore compreso tra 35.0 e 42.0 °C.');
      return;
    }

    if (brMin >= brMax) {
      Alert.alert('Errore', 'Frequenza respiratoria minima deve essere inferiore alla massima.');
      return;
    }

    try {
      const response = await fetch(`${API_URL}/neonates/${selectedNeonate.id}/thresholds`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          hr_min: hrMin,
          hr_max: hrMax,
          temp_min: tempMin,
          temp_max: tempMax,
          br_min: brMin,
          br_max: brMax
        })
      });

      if (response.ok) {
        const updated = await response.json();
        setThresholds(updated);
        Alert.alert('Successo', 'Soglie cliniche salvate e aggiornate.');
        setEditThresholdsModal(false);
      } else {
        const errMsg = await getErrorMessage(response, 'Impossibile aggiornare le soglie.');
        throw new Error(errMsg);
      }
    } catch (e: any) {
      Alert.alert('Errore', e.message);
    }
  };

  // Filter patients by name or shirt ID for Pediatra (IF-1.8)
  const filteredNeonates = useMemo(() => {
    if (!searchQuery) return neonates;
    return neonates.filter((n) =>
      `${n.first_name} ${n.last_name}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
      n.device_id.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [neonates, searchQuery]);

  // Prepares charts
  const hrChartData = useMemo(() => {
    const data = chartSamples.length ? chartSamples : [0];
    return {
      labels: data.map((_, i) => ''),
      datasets: [{ data }]
    };
  }, [chartSamples]);

  // Pulisce i campioni ECG grezzi della maglietta PRIMA di filtrarli:
  // rimuove il codice di clipping di fondo scala dell'ADC (1638400 = 0x190000), i valori
  // non fisici (<= 0) e gli spike isolati, sostituendoli con interpolazione lineare sui
  // campioni validi adiacenti. Senza questo passaggio gli artefatti generano transienti
  // enormi nel passa-alto e gonfiano la normalizzazione, rendendo le onde PQRST invisibili.
  const sanitizeEcg = (raw: number[], clip = 1600000) => {
    const n = raw.length;
    const v = raw.map(x => (Number.isFinite(x) ? x : NaN));
    const valid = v.map(x => Number.isFinite(x) && x > 0 && x < clip);

    // 1) interpola linearmente i campioni non validi (clipping / fuori range / NaN)
    for (let i = 0; i < n; i++) {
      if (valid[i]) continue;
      let a = i - 1; while (a >= 0 && !valid[a]) a--;
      let b = i + 1; while (b < n && !valid[b]) b++;
      if (a < 0 && b >= n) v[i] = 0;
      else if (a < 0) v[i] = v[b];
      else if (b >= n) v[i] = v[a];
      else v[i] = v[a] + ((v[b] - v[a]) * (i - a)) / (b - a);
    }

    // 2) despike residuo con filtro di Hampel (mediana mobile, finestra 7)
    const k = 3;
    const out = v.slice();
    for (let i = 0; i < n; i++) {
      const win = v.slice(Math.max(0, i - k), Math.min(n, i + k + 1)).sort((p, q) => p - q);
      const med = win[Math.floor(win.length / 2)];
      const mad = win.map(x => Math.abs(x - med)).sort((p, q) => p - q)[Math.floor(win.length / 2)] + 1e-9;
      if (Math.abs(v[i] - med) > 4 * 1.4826 * mad) out[i] = med;
    }
    return out;
  };

  // Filtro per i campioni ECG in tempo reale (rimuove il baseline wander, applica Notch 50Hz e smussa il rumore)
  const filterEcgSamples = (rawSamples: number[]) => {
    if (!rawSamples || rawSamples.length === 0) return [];

    // 0. Declip + despike degli artefatti dell'ADC (clipping/spike) prima di ogni filtro
    const cleaned = sanitizeEcg(rawSamples);
    if (!cleaned.length) return [];

    // Rimuove l'offset DC usando la MEDIANA (robusta rispetto agli artefatti residui,
    // a differenza della media che verrebbe falsata dai valori di clipping)
    const sortedDc = [...cleaned].sort((a, b) => a - b);
    const median = sortedDc[Math.floor(sortedDc.length / 2)];
    const zeroMeanSamples = cleaned.map(v => v - median);

    // 1. Rimuove la componente continua (baseline wander) usando un filtro IIR passa-alto
    // y_hp[n] = x[n] - x[n-1] + 0.985 * y_hp[n-1]
    const highPassed: number[] = [];
    let prevX = zeroMeanSamples[0] || 0;
    let prevYHp = 0;
    for (let i = 0; i < zeroMeanSamples.length; i++) {
      const x = zeroMeanSamples[i];
      const y = x - prevX + 0.985 * prevYHp;
      highPassed.push(y);
      prevX = x;
      prevYHp = y;
    }

    // 2. Filtro Notch a 50Hz per la rimozione del rumore di rete (frequenza di campionamento = 128 Hz)
    // y_notch[n] = x_hp[n] + 1.54602 * x_hp[n-1] + x_hp[n-2] - 1.46872 * y_notch[n-1] - 0.9025 * y_notch[n-2]
    const notched: number[] = [];
    for (let i = 0; i < highPassed.length; i++) {
      const x0 = highPassed[i];
      const x1 = i > 0 ? highPassed[i - 1] : 0;
      const x2 = i > 1 ? highPassed[i - 2] : 0;
      const y1 = i > 0 ? notched[i - 1] : 0;
      const y2 = i > 1 ? notched[i - 2] : 0;

      const y0 = x0 + 1.54602 * x1 + x2 - 1.46872 * y1 - 0.9025 * y2;
      notched.push(y0);
    }

    // 3. Filtro di smoothing (media mobile su 3 punti) per smussare il rumore residuo ad alta frequenza
    const smoothed = notched.map((val, idx) => {
      const start = Math.max(0, idx - 1);
      const end = Math.min(notched.length, idx + 2);
      const sub = notched.slice(start, end);
      return sub.reduce((sum, v) => sum + v, 0) / sub.length;
    });

    return smoothed;
  };

  // Trova gli indici dei picchi R nel segnale normalizzato (compreso tra -1.0 e 1.0)
  const findRPeakIndices = (samples: number[]) => {
    const indices: number[] = [];
    if (samples.length < 5) return indices;

    const threshold = 0.58; // I picchi R superano sempre il 58% del valore massimo normalizzato
    const minDistance = 20;  // Distanza minima tra due picchi R successivi (128Hz sampling)

    let lastPeakIdx = -minDistance;

    for (let i = 2; i < samples.length - 2; i++) {
      const val = samples[i];
      // Controlla se è un massimo locale ed è superiore alla soglia
      if (val > threshold && val > samples[i - 1] && val > samples[i - 2] && val > samples[i + 1] && val > samples[i + 2]) {
        if (i - lastPeakIdx >= minDistance) {
          indices.push(i);
          lastPeakIdx = i;
        }
      }
    }
    return indices;
  };

  // Prepara i campioni ECG normalizzati e filtrati
  const ecgSamplesNormalized = useMemo(() => {
    const filtered = filterEcgSamples(rawEcgBuffer);
    if (!filtered.length) return [];

    // Normalizzazione ROBUSTA: usa il 98° percentile del valore assoluto invece del massimo
    // assoluto, così un eventuale transiente residuo non schiaccia l'intero tracciato.
    // L'asse resta centrato sullo zero e le onde PQRST/ i picchi R restano ben visibili.
    const absSorted = filtered.map(Math.abs).sort((a, b) => a - b);
    const scale = absSorted[Math.floor(0.98 * (absSorted.length - 1))] || 0;
    if (scale > 0) {
      return filtered.map(v => {
        let n = v / scale;
        if (n > 1.2) n = 1.2; else if (n < -1.2) n = -1.2; // clamp leggero per stabilità dell'asse
        return Number(n.toFixed(3));
      });
    }
    return filtered;
  }, [rawEcgBuffer]);

  // Indici dei picchi R calcolati sui campioni normalizzati
  const rPeakIndices = useMemo(() => {
    return findRPeakIndices(ecgSamplesNormalized);
  }, [ecgSamplesNormalized]);

  const ecgChartData = useMemo(() => {
    const data = ecgSamplesNormalized.length ? ecgSamplesNormalized : new Array(120).fill(0);
    return {
      labels: data.map((_, i) => ''),
      datasets: [{ data }]
    };
  }, [ecgSamplesNormalized]);

  const getOrientationText = (code: number | undefined) => {
    if (code === undefined) return 'Sconosciuta';
    // Decodifica a bitmask delle posizioni per gestire codici composti (es. 72 = 64 + 8)
    if (code & 16) return 'Prona ⚠️';
    if (code & 32) return 'Supina 🛌';
    if (code & 8) return 'In piedi / Seduto 🧍';
    if (code & 4) return 'A testa in giù 🙃';
    if (code & 2) return 'Fianco Dx ➡️';
    if (code & 1) return 'Fianco Sx ⬅️';
    if (code === 0) return 'Transizione 🔄';
    return `Codice ${code}`;
  };

  const flipCard = (animValue: Animated.Value, toValue: number) => {
    Animated.spring(animValue, {
      toValue,
      friction: 8,
      tension: 10,
      useNativeDriver: true,
    }).start();
  };

  const handleFlipHr = (targetState: boolean) => {
    setFlippedHr(targetState);
    flipCard(flipAnimHr, targetState ? 1 : 0);
  };

  const handleFlipTemp = (targetState: boolean) => {
    setFlippedTemp(targetState);
    flipCard(flipAnimTemp, targetState ? 1 : 0);
  };

  const handleFlipBr = (targetState: boolean) => {
    setFlippedBr(targetState);
    flipCard(flipAnimBr, targetState ? 1 : 0);
  };

  const handleFlipPos = (targetState: boolean) => {
    setFlippedPos(targetState);
    flipCard(flipAnimPos, targetState ? 1 : 0);
  };

  // 3D Flip Anim Interpolations
  const frontInterpolateHr = flipAnimHr.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
  const backInterpolateHr = flipAnimHr.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '360deg'] });
  const frontOpacityHr = flipAnimHr.interpolate({ inputRange: [0, 0.5, 0.51, 1], outputRange: [1, 1, 0, 0] });
  const backOpacityHr = flipAnimHr.interpolate({ inputRange: [0, 0.5, 0.51, 1], outputRange: [0, 0, 1, 1] });

  const frontInterpolateTemp = flipAnimTemp.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
  const backInterpolateTemp = flipAnimTemp.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '360deg'] });
  const frontOpacityTemp = flipAnimTemp.interpolate({ inputRange: [0, 0.5, 0.51, 1], outputRange: [1, 1, 0, 0] });
  const backOpacityTemp = flipAnimTemp.interpolate({ inputRange: [0, 0.5, 0.51, 1], outputRange: [0, 0, 1, 1] });

  const frontInterpolateBr = flipAnimBr.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
  const backInterpolateBr = flipAnimBr.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '360deg'] });
  const frontOpacityBr = flipAnimBr.interpolate({ inputRange: [0, 0.5, 0.51, 1], outputRange: [1, 1, 0, 0] });
  const backOpacityBr = flipAnimBr.interpolate({ inputRange: [0, 0.5, 0.51, 1], outputRange: [0, 0, 1, 1] });

  const frontInterpolatePos = flipAnimPos.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
  const backInterpolatePos = flipAnimPos.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '360deg'] });
  const frontOpacityPos = flipAnimPos.interpolate({ inputRange: [0, 0.5, 0.51, 1], outputRange: [1, 1, 0, 0] });
  const backOpacityPos = flipAnimPos.interpolate({ inputRange: [0, 0.5, 0.51, 1], outputRange: [0, 0, 1, 1] });

  const renderCardFront = (emoji: string, val: string | number, unit: string, title: string, isSmallVal = false) => (
    <>
      <View style={styles.cardFrontHeader}>
        <Text style={styles.cardEmoji}>{emoji}</Text>
      </View>
      <Text style={isSmallVal ? styles.cardValSmall : styles.cardVal}>{val}</Text>
      <Text style={styles.cardUnit}>{unit || ' '}</Text>
      <Text style={styles.cardTitle}>{title}</Text>
    </>
  );

  const renderCardBack = (title: string, history: HistoryEntry[], unit: string, onFlipBack: () => void) => (
    <Pressable onPress={onFlipBack} style={{ flex: 1 }}>
      <View style={styles.cardBackHeader}>
        <Text style={styles.cardBackTitle}>{title}</Text>
        <Text style={styles.cardBackClose}>✕</Text>
      </View>
      {history.length === 0 ? (
        <Pressable onPress={onFlipBack} style={styles.emptyHistoryContainer}>
          <Text style={styles.noHistoryText}>Nessun dato registrato</Text>
        </Pressable>
      ) : (
        <ScrollView 
          style={styles.historyScroll} 
          nestedScrollEnabled={true}
          onTouchStart={() => setParentScrollEnabled(false)}
          onTouchEnd={() => setParentScrollEnabled(true)}
          onTouchCancel={() => setParentScrollEnabled(true)}
        >
          <Pressable onPress={onFlipBack}>
            {history.slice().reverse().map((item, idx) => (
              <View key={idx} style={styles.historyRow}>
                <Text style={styles.historyVal}>{item.value}{unit ? ` ${unit}` : ''}</Text>
                <Text style={styles.historyTime}>{item.time}</Text>
              </View>
            ))}
          </Pressable>
        </ScrollView>
      )}
    </Pressable>
  );

  // --- RENDERING ---
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0A1926" />

      {/* HEADER SECTION */}
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Image
            source={require('./assets/LogoBabyGuard.jpeg')}
            style={{ width: 40, height: 40, borderRadius: 20, marginRight: 10 }}
          />
          <View>
            <Text style={styles.headerTitle}>BabyGuard IoMT</Text>
            <Text style={styles.headerSub}>
              {role ? `Area ${role === 'doctor' ? 'Pediatra' : 'Genitore'}` : 'Controllo sonno neonatale'}
            </Text>
          </View>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => setShowConfig(!showConfig)} style={styles.configBtn}>
            <Text style={styles.configBtnText}>⚙️ IP</Text>
          </TouchableOpacity>
          {token && (
            <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}>
              <Text style={styles.logoutBtnText}>Esci</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* IP CONFIG & SETTINGS DRAWER */}
      {showConfig && (
        <View style={styles.configDrawer}>
          <View style={styles.drawerHeader}>
            <Text style={styles.configLabel}>⚙️ Impostazioni</Text>
            <TouchableOpacity onPress={() => setShowConfig(false)} style={styles.closeDrawerBtn}>
              <Text style={styles.closeDrawerText}>Chiudi ✕</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.configSection}>
            <Text style={styles.configSubLabel}>IP Server Backend:</Text>
            <View style={styles.ipInputRow}>
              <TextInput
                style={styles.ipInput}
                value={backendIp}
                onChangeText={setBackendIp}
                placeholder="es. 192.168.1.15"
                placeholderTextColor="#888"
              />
            </View>
          </View>

          {token && (
            <View style={[styles.configSection, { marginTop: 15, borderTopWidth: 1, borderTopColor: '#1F3A52', paddingTop: 15 }]}>
              <Text style={styles.configSubLabel}>🤖 Notifiche Bot Telegram:</Text>

              {telegramLoading ? (
                <ActivityIndicator size="small" color="#00D2C4" style={{ marginVertical: 10 }} />
              ) : telegramAssociated ? (
                <View style={styles.telegramStatusCard}>
                  <Text style={styles.telegramStatusText}>
                    🟢 Telegram collegato con successo!
                  </Text>
                  {telegramChatId && (
                    <Text style={styles.telegramSubText}>Chat ID: {telegramChatId}</Text>
                  )}
                  <TouchableOpacity onPress={handleUnlinkTelegram} style={styles.telegramUnlinkBtn}>
                    <Text style={styles.telegramUnlinkBtnText}>Rimuovi associazione 🔌</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.telegramStatusCard}>
                  <Text style={styles.telegramStatusText}>
                    🔴 Nessun account Telegram collegato.
                  </Text>
                  <Text style={styles.telegramInfoText}>
                    Collega il tuo account per ricevere alert critici direttamente su Telegram.
                  </Text>

                  {telegramCode ? (
                    <View style={styles.telegramCodeContainer}>
                      <Text style={styles.telegramCodeLabel}>Codice di associazione:</Text>
                      <Text style={styles.telegramCode}>{telegramCode}</Text>

                      <TouchableOpacity
                        onPress={() => Linking.openURL(`https://t.me/${telegramBotUsername}?start=${telegramCode}`)}
                        style={[styles.telegramLinkBtn, { backgroundColor: '#0088CC', width: '100%', marginBottom: 12, paddingVertical: 10 }]}
                      >
                        <Text style={styles.telegramLinkBtnText}>💬 Apri Chat e Collega</Text>
                      </TouchableOpacity>

                      <Text style={styles.telegramInstructions}>
                        Premi il pulsante azzurro sopra per aprire Telegram. Si aprirà la chat del Bot <Text style={{ fontWeight: 'bold', color: '#00D2C4' }}>@{telegramBotUsername}</Text> con il codice già inserito.{"\n"}
                        Ti basterà premere su <Text style={{ fontWeight: 'bold', color: '#FFF' }}>"AVVIA" / "START"</Text> per completare l'associazione!{"\n\n"}
                        Al termine, premi il tasto sotto per aggiornare lo stato.
                      </Text>
                      <TouchableOpacity
                        onPress={() => fetchTelegramStatus(token)}
                        style={styles.telegramVerifyBtn}
                      >
                        <Text style={styles.telegramVerifyBtnText}>🔄 Verifica Associazione</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity onPress={handleGenerateTelegramCode} style={styles.telegramLinkBtn}>
                      <Text style={styles.telegramLinkBtnText}>🔗 Collega Telegram</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          )}
        </View>
      )}

      {/* AUTH SCREEN */}
      {!token ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView
            contentContainerStyle={styles.authContainer}
            keyboardShouldPersistTaps="handled"
          >
            <Image
              source={require('./assets/LogoBabyGuard.jpeg')}
              style={{ width: 120, height: 120, borderRadius: 60, alignSelf: 'center', marginBottom: 20 }}
            />
            <View style={styles.authCard}>
              <Text style={styles.authTitle}>{isRegistering ? 'Crea Account' : 'Accedi'}</Text>

              {isRegistering && (
                <View style={styles.roleTabRow}>
                  <TouchableOpacity
                    style={[styles.roleTab, selectedRole === 'parent' && styles.roleTabActive]}
                    onPress={() => setSelectedRole('parent')}
                  >
                    <Text style={[styles.roleTabText, selectedRole === 'parent' && styles.roleTabTextActive]}>Genitore</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.roleTab, selectedRole === 'doctor' && styles.roleTabActive]}
                    onPress={() => setSelectedRole('doctor')}
                  >
                    <Text style={[styles.roleTabText, selectedRole === 'doctor' && styles.roleTabTextActive]}>Pediatra</Text>
                  </TouchableOpacity>
                </View>
              )}

              <TextInput
                style={[styles.authInput, validationErrors.username && styles.inputError]}
                placeholder="Username"
                placeholderTextColor="#888"
                value={username}
                onChangeText={(text) => {
                  setUsername(text);
                  if (validationErrors.username) setValidationErrors(prev => ({ ...prev, username: '' }));
                }}
                autoCapitalize="none"
              />
              {validationErrors.username ? (
                <Text style={styles.errorText}>{validationErrors.username}</Text>
              ) : null}

              {isRegistering && (
                <>
                  <TextInput
                    style={[styles.authInput, validationErrors.firstName && styles.inputError]}
                    placeholder="Nome"
                    placeholderTextColor="#888"
                    value={firstName}
                    onChangeText={(text) => {
                      setFirstName(text);
                      if (validationErrors.firstName) setValidationErrors(prev => ({ ...prev, firstName: '' }));
                    }}
                  />
                  {validationErrors.firstName ? (
                    <Text style={styles.errorText}>{validationErrors.firstName}</Text>
                  ) : null}

                  <TextInput
                    style={[styles.authInput, validationErrors.lastName && styles.inputError]}
                    placeholder="Cognome"
                    placeholderTextColor="#888"
                    value={lastName}
                    onChangeText={(text) => {
                      setLastName(text);
                      if (validationErrors.lastName) setValidationErrors(prev => ({ ...prev, lastName: '' }));
                    }}
                  />
                  {validationErrors.lastName ? (
                    <Text style={styles.errorText}>{validationErrors.lastName}</Text>
                  ) : null}

                  <TextInput
                    style={[styles.authInput, validationErrors.email && styles.inputError]}
                    placeholder="Email"
                    placeholderTextColor="#888"
                    value={email}
                    onChangeText={(text) => {
                      setEmail(text);
                      if (validationErrors.email) setValidationErrors(prev => ({ ...prev, email: '' }));
                    }}
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                  {validationErrors.email ? (
                    <Text style={styles.errorText}>{validationErrors.email}</Text>
                  ) : null}

                  {selectedRole === 'doctor' && (
                    <>
                      <TextInput
                        style={[styles.authInput, validationErrors.medicalId && styles.inputError]}
                        placeholder="Codice Identificativo Medico (es. RM-45928)"
                        placeholderTextColor="#888"
                        value={medicalId}
                        onChangeText={(text) => {
                          setMedicalId(text);
                          if (validationErrors.medicalId) setValidationErrors(prev => ({ ...prev, medicalId: '' }));
                        }}
                        autoCapitalize="characters"
                      />
                      {validationErrors.medicalId ? (
                        <Text style={styles.errorText}>{validationErrors.medicalId}</Text>
                      ) : null}
                    </>
                  )}
                </>
              )}

              <View style={[
                styles.passwordContainer,
                validationErrors.password ? styles.inputError : null
              ]}>
                <TextInput
                  style={styles.passwordInput}
                  placeholder="Password"
                  placeholderTextColor="#888"
                  value={password}
                  onChangeText={(text) => {
                    setPassword(text);
                    if (validationErrors.password) setValidationErrors(prev => ({ ...prev, password: '' }));
                  }}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeButton}>
                  <Text style={[styles.eyeIcon, showPassword && { color: C.mint }]}>👁️</Text>
                </TouchableOpacity>
              </View>
              {validationErrors.password ? (
                <Text style={styles.errorText}>{validationErrors.password}</Text>
              ) : null}

              {isRegistering && (
                <>
                  <View style={[
                    styles.passwordContainer,
                    validationErrors.confirmPassword ? styles.inputError : null
                  ]}>
                    <TextInput
                      style={styles.passwordInput}
                      placeholder="Conferma Password"
                      placeholderTextColor="#888"
                      value={confirmPassword}
                      onChangeText={(text) => {
                        setConfirmPassword(text);
                        if (validationErrors.confirmPassword) setValidationErrors(prev => ({ ...prev, confirmPassword: '' }));
                      }}
                      secureTextEntry={!showConfirmPassword}
                      autoCapitalize="none"
                    />
                    <TouchableOpacity onPress={() => setShowConfirmPassword(!showConfirmPassword)} style={styles.eyeButton}>
                      <Text style={[styles.eyeIcon, showConfirmPassword && { color: C.mint }]}>👁️</Text>
                    </TouchableOpacity>
                  </View>
                  {validationErrors.confirmPassword ? (
                    <Text style={styles.errorText}>{validationErrors.confirmPassword}</Text>
                  ) : null}
                </>
              )}

              <TouchableOpacity onPress={handleAuth} style={styles.authBtn} disabled={authLoading}>
                {authLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.authBtnText}>{isRegistering ? 'REGISTRATI' : 'ACCEDI'}</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity onPress={() => {
                setIsRegistering(!isRegistering);
                setPassword('');
                setConfirmPassword('');
                setValidationErrors({});
              }} style={styles.authToggle}>
                <Text style={styles.authToggleText}>
                  {isRegistering ? 'Hai già un account? Accedi' : 'Non hai un account? Registrati'}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      ) : (
        /* CORE DASHBOARD SCREEN */
        <View style={{ flex: 1 }}>
          {/* SEARCH & SELECTION BAR */}
          <View style={styles.pickerSection}>
            {role === 'doctor' && (
              <TextInput
                style={styles.searchInput}
                placeholder="🔍 Cerca paziente per Nome o ID Maglietta..."
                placeholderTextColor="#888"
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
            )}

            <View style={styles.pickerHeaderRow}>
              <Text style={styles.sectionLabel}>
                {role === 'doctor' ? 'Pazienti in Carico:' : 'Figlio Monitorato:'}
              </Text>
              {role === 'parent' && (
                <TouchableOpacity onPress={() => setShowAddBabyModal(true)} style={styles.addBabyBtn}>
                  <Text style={styles.addBabyBtnText}>+ Associa Maglietta</Text>
                </TouchableOpacity>
              )}
              {role === 'doctor' && (
                <TouchableOpacity onPress={handleOpenDashboard} style={styles.addBabyBtn}>
                  <Text style={styles.addBabyBtnText}>📊 Dashboard Clinica</Text>
                </TouchableOpacity>
              )}
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.neonateScroll}>
              {filteredNeonates.map((n) => (
                <TouchableOpacity
                  key={n.id}
                  style={[
                    styles.neonateBadge,
                    selectedNeonate?.id === n.id && styles.neonateBadgeActive
                  ]}
                  onPress={() => setSelectedNeonate(n)}
                >
                  <Text style={[
                    styles.neonateBadgeText,
                    selectedNeonate?.id === n.id && styles.neonateBadgeTextActive
                  ]}>
                    👦 {n.first_name} {n.last_name}
                  </Text>
                </TouchableOpacity>
              ))}
              {filteredNeonates.length === 0 && (
                <Text style={styles.noNeonates}>
                  {role === 'doctor'
                    ? 'Nessun paziente trovato.'
                    : 'Nessun bambino associato. Clicca su "+ Associa Maglietta"'}
                </Text>
              )}
            </ScrollView>

            {/* WS Status & Info */}
            {selectedNeonate && (
              <View style={styles.statusRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Text style={styles.deviceInfoText}>ID Maglietta: {selectedNeonate.device_id || 'Nessuna'}</Text>
                  {liveData.battery_level !== undefined && (
                    <Text style={[styles.deviceInfoText, { color: liveData.battery_level <= 15 ? '#FF4A5A' : '#4E9F3D', fontWeight: 'bold' }]}>
                      🔋 {liveData.battery_level}% {liveData.battery_charging ? '(in carica)' : ''}
                    </Text>
                  )}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  {role === 'parent' ? (
                    <TouchableOpacity onPress={() => handleDissociateDevice(selectedNeonate.id)} style={styles.dissociateBtn}>
                      <Text style={styles.dissociateBtnText}>
                        {selectedNeonate.device_id ? 'Dissocia 🔌' : 'Elimina 🗑️'}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                  <Text style={[
                    styles.statusBadge,
                    (wsConnected && shirtConnected) ? styles.statusLive : styles.statusDisconnected
                  ]}>
                    {(wsConnected && shirtConnected) ? '🟢 Live' : '🔴 Disconnesso'}
                  </Text>
                </View>
              </View>
            )}
          </View>

          {selectedNeonate ? (
            <ScrollView style={styles.scrollContent} scrollEnabled={parentScrollEnabled}>
              {role === 'parent' && (
                <TouchableOpacity onPress={openEditBabyModal} style={styles.editNeonateBtn}>
                  <Text style={styles.editNeonateBtnText}>✏️ Modifica Dati Neonato</Text>
                </TouchableOpacity>
              )}

              {/* BABY DETAILS CHIPS (Sesso, Età, Altezza, Peso, Gest.) */}
              <View style={[styles.babyBioContainer, { flexWrap: 'wrap' }]}>
                <View style={styles.bioChip}>
                  <Text style={styles.bioChipLabel}>Sesso</Text>
                  <Text style={styles.bioChipValue}>{selectedNeonate.gender === 'F' ? '🌸 F' : '💎 M'}</Text>
                </View>
                <View style={styles.bioChip}>
                  <Text style={styles.bioChipLabel}>Età</Text>
                  <Text style={styles.bioChipValue}>
                    {selectedNeonate.age !== null && selectedNeonate.age !== undefined
                      ? `${selectedNeonate.age} m`
                      : '--'}
                  </Text>
                </View>
                <View style={styles.bioChip}>
                  <Text style={styles.bioChipLabel}>Altezza</Text>
                  <Text style={styles.bioChipValue}>
                    {selectedNeonate.height !== null && selectedNeonate.height !== undefined
                      ? `${selectedNeonate.height} cm`
                      : '--'}
                  </Text>
                </View>
                <View style={styles.bioChip}>
                  <Text style={styles.bioChipLabel}>Peso</Text>
                  <Text style={styles.bioChipValue}>
                    {selectedNeonate.weight !== null && selectedNeonate.weight !== undefined
                      ? `${selectedNeonate.weight} kg`
                      : '--'}
                  </Text>
                </View>
                <View style={styles.bioChip}>
                  <Text style={styles.bioChipLabel}>Gest.</Text>
                  <Text style={styles.bioChipValue}>
                    {selectedNeonate.gestational_age_weeks !== null && selectedNeonate.gestational_age_weeks !== undefined
                      ? `${selectedNeonate.gestational_age_weeks} sett`
                      : '--'}
                  </Text>
                </View>
              </View>

              {/* DEVICE ASSOCIATION CARD (IF-1.5) */}
              {!selectedNeonate.device_id && role === 'parent' && (
                <View style={styles.associateCard}>
                  <Text style={styles.associateTitle}>🔌 Associa Smart Shirt</Text>
                  <Text style={styles.associateDesc}>
                    Nessuna Smart Shirt associata a questo neonato. Inserisci l'ID del dispositivo per attivare il monitoraggio continuo.
                  </Text>
                  <View style={styles.associateInputRow}>
                    <TextInput
                      style={styles.associateInput}
                      value={associateDeviceId}
                      onChangeText={setAssociateDeviceId}
                      placeholder="es. MAG_001"
                      placeholderTextColor="#888"
                    />
                    <TouchableOpacity onPress={() => handleAssociateDevice(selectedNeonate.id)} style={styles.associateBtnSubmit}>
                      <Text style={styles.associateBtnSubmitText}>Associa</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {/* WARNING FOR DOCTOR IF NO DEVICE */}
              {!selectedNeonate.device_id && role === 'doctor' && (
                <View style={styles.noDeviceWarningCard}>
                  <Text style={styles.warningTitle}>⚠️ Nessun Dispositivo Associato</Text>
                  <Text style={styles.warningDesc}>
                    Il genitore non ha ancora associato una Smart Shirt a questo profilo. I dati in tempo reale non saranno disponibili fino all'associazione.
                  </Text>
                </View>
              )}

              {/* LIVE VALUES PANEL */}
              <View style={styles.liveGrid}>
                {/* Heart Rate Card */}
                {role === 'parent' ? (
                  <View style={styles.cardContainer}>
                    <Animated.View style={[styles.liveCard, styles.cardHr, { transform: [{ rotateY: frontInterpolateHr }], opacity: frontOpacityHr, marginBottom: 0 }]}>
                      <TouchableOpacity
                        activeOpacity={0.9}
                        onPress={() => handleFlipHr(true)}
                        style={styles.cardTouchWrapper}
                      >
                        {renderCardFront('❤️', liveData.heartrate || '--', 'BPM', 'Battito Cardiaco')}
                      </TouchableOpacity>
                    </Animated.View>
                    <Animated.View style={[styles.liveCard, styles.cardHr, styles.cardFlipped, { transform: [{ rotateY: backInterpolateHr }], opacity: backOpacityHr, position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, marginBottom: 0 }]}>
                      {renderCardBack('Storico BPM', hrHistory, 'BPM', () => handleFlipHr(false))}
                    </Animated.View>
                  </View>
                ) : (
                  <View style={[styles.liveCard, styles.cardHr]}>
                    {renderCardFront('❤️', liveData.heartrate || '--', 'BPM', 'Battito Cardiaco')}
                  </View>
                )}

                {/* Temperature Card */}
                {role === 'parent' ? (
                  <View style={styles.cardContainer}>
                    <Animated.View style={[styles.liveCard, styles.cardTemp, { transform: [{ rotateY: frontInterpolateTemp }], opacity: frontOpacityTemp, marginBottom: 0 }]}>
                      <TouchableOpacity
                        activeOpacity={0.9}
                        onPress={() => handleFlipTemp(true)}
                        style={styles.cardTouchWrapper}
                      >
                        {renderCardFront('🌡️', liveData.temperature !== undefined ? `${liveData.temperature.toFixed(1)}` : '--', '°C', 'Temperatura')}
                      </TouchableOpacity>
                    </Animated.View>
                    <Animated.View style={[styles.liveCard, styles.cardTemp, styles.cardFlipped, { transform: [{ rotateY: backInterpolateTemp }], opacity: backOpacityTemp, position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, marginBottom: 0 }]}>
                      {renderCardBack('Storico Temp', tempHistory, '°C', () => handleFlipTemp(false))}
                    </Animated.View>
                  </View>
                ) : (
                  <View style={[styles.liveCard, styles.cardTemp]}>
                    {renderCardFront('🌡️', liveData.temperature !== undefined ? `${liveData.temperature.toFixed(1)}` : '--', '°C', 'Temperatura')}
                  </View>
                )}

                {/* Breathing Rate Card */}
                {role === 'parent' ? (
                  <View style={styles.cardContainer}>
                    <Animated.View style={[styles.liveCard, styles.cardBr, { transform: [{ rotateY: frontInterpolateBr }], opacity: frontOpacityBr, marginBottom: 0 }]}>
                      <TouchableOpacity
                        activeOpacity={0.9}
                        onPress={() => handleFlipBr(true)}
                        style={styles.cardTouchWrapper}
                      >
                        {renderCardFront('🫁', liveData.breathrate || '--', 'atti/min', 'Respiro')}
                      </TouchableOpacity>
                    </Animated.View>
                    <Animated.View style={[styles.liveCard, styles.cardBr, styles.cardFlipped, { transform: [{ rotateY: backInterpolateBr }], opacity: backOpacityBr, position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, marginBottom: 0 }]}>
                      {renderCardBack('Storico Respiro', brHistory, 'atti/m', () => handleFlipBr(false))}
                    </Animated.View>
                  </View>
                ) : (
                  <View style={[styles.liveCard, styles.cardBr]}>
                    {renderCardFront('🫁', liveData.breathrate || '--', 'atti/min', 'Respiro')}
                  </View>
                )}

                {/* Position Card */}
                {role === 'parent' ? (
                  <View style={styles.cardContainer}>
                    <Animated.View style={[styles.liveCard, styles.cardPos, { transform: [{ rotateY: frontInterpolatePos }], opacity: frontOpacityPos, marginBottom: 0 }]}>
                      <TouchableOpacity
                        activeOpacity={0.9}
                        onPress={() => handleFlipPos(true)}
                        style={styles.cardTouchWrapper}
                      >
                        {renderCardFront('🧘', liveData.orientation !== undefined ? getOrientationText(liveData.orientation) : '--', '', 'Postura Sonno', true)}
                      </TouchableOpacity>
                    </Animated.View>
                    <Animated.View style={[styles.liveCard, styles.cardPos, styles.cardFlipped, { transform: [{ rotateY: backInterpolatePos }], opacity: backOpacityPos, position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, marginBottom: 0 }]}>
                      {renderCardBack('Storico Postura', posHistory, '', () => handleFlipPos(false))}
                    </Animated.View>
                  </View>
                ) : (
                  <View style={[styles.liveCard, styles.cardPos]}>
                    {renderCardFront('🧘', liveData.orientation !== undefined ? getOrientationText(liveData.orientation) : '--', '', 'Postura Sonno', true)}
                  </View>
                )}
              </View>

              {/* ECG REAL-TIME CHART */}
              <View style={styles.chartCard}>
                <Text style={styles.cardSectionTitle}>Tracciato ECG in tempo reale (Onde PQRST)</Text>
                <LineChart
                  data={ecgChartData}
                  width={Dimensions.get('window').width - 64}
                  height={170}
                  chartConfig={{
                    backgroundColor: '#12293C',
                    backgroundGradientFrom: '#12293C',
                    backgroundGradientTo: '#12293C',
                    decimalPlaces: 1,
                    color: (opacity = 1) => `rgba(71, 193, 176, ${opacity})`, // Verde menta del logo
                    labelColor: (opacity = 1) => `rgba(255, 255, 255, ${opacity * 0.7})`, // Testo bianco trasparente
                    style: { borderRadius: 16 },
                    propsForBackgroundLines: {
                      strokeWidth: 1,
                      stroke: '#1F3E57', // Grigio-blu dei bordi
                      strokeDasharray: '3', // Tratteggiato moderno
                    },
                    propsForLabels: {
                      fontSize: 9,
                    }
                  }}
                  bezier
                  withDots={true}
                  withHorizontalLabels={true} // Mostra l'asse Y con la scala
                  withVerticalLabels={false}   // Nasconde le etichette X
                  getDotProps={(value, index) => {
                    const isRPeak = rPeakIndices.includes(index);
                    return {
                      r: isRPeak ? '3' : '0',
                      strokeWidth: isRPeak ? '1' : '0',
                      stroke: '#FF3366', // Bordo rosso neon per il picco R
                      fill: '#FF6688',   // Riempimento rosa/rosso chiaro
                    };
                  }}
                  style={styles.chart}
                />

                {/* LEGENDA UMANA PER I GENITORI */}
                <View style={styles.ecgLegendContainer}>
                  <View style={styles.ecgLegendItem}>
                    <Text style={styles.ecgLegendDotCyan}>⬤</Text>
                    <Text style={styles.ecgLegendText}>Onda PQRST (Segnale cardiaco sano e regolare)</Text>
                  </View>
                  <View style={styles.ecgLegendItem}>
                    <Text style={styles.ecgLegendDotRed}>⬤</Text>
                    <Text style={styles.ecgLegendText}>Picco R (Evidenziazione automatica del battito ventricolare)</Text>
                  </View>
                </View>
              </View>

              {/* THRESHOLDS CONFIG BOX */}
              {thresholds && (
                <View style={styles.thresholdsCard}>
                  <View style={styles.thresholdsHeader}>
                    <Text style={styles.cardSectionTitle}>Soglie di Allarme Cliniche</Text>
                    {role === 'doctor' && (
                      <TouchableOpacity onPress={() => setEditThresholdsModal(true)} style={styles.editBtn}>
                        <Text style={styles.editBtnText}>Modifica 🩺</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  <View style={styles.thresholdsGrid}>
                    <View style={styles.thresholdRow}>
                      <Text style={styles.thresholdName}>Frequenza Cardiaca (BPM):</Text>
                      <Text style={styles.thresholdVal}>{thresholds.hr_min} - {thresholds.hr_max}</Text>
                    </View>
                    <View style={styles.thresholdRow}>
                      <Text style={styles.thresholdName}>Temperatura (°C):</Text>
                      <Text style={styles.thresholdVal}>{thresholds.temp_min}° - {thresholds.temp_max}°</Text>
                    </View>
                    <View style={styles.thresholdRow}>
                      <Text style={styles.thresholdName}>Frequenza Respiratoria:</Text>
                      <Text style={styles.thresholdVal}>{thresholds.br_min} - {thresholds.br_max}</Text>
                    </View>
                  </View>
                </View>
              )}

              {/* AHI DIAGNOSTIC BOX (DF-1.6) */}
              {ahiData && (
                <View style={styles.thresholdsCard}>
                  <View style={styles.thresholdsHeader}>
                    <Text style={styles.cardSectionTitle}>Diagnostica Indice AHI (Sonno)</Text>
                    <View style={[
                      styles.statusBadge,
                      ahiData.status === 'Normal' ? styles.statusLive :
                        ahiData.status === 'Mild' ? styles.alertNormal :
                          ahiData.status === 'Moderate' ? styles.alertHigh : styles.alertCritical
                    ]}>
                      <Text style={{ fontWeight: 'bold', fontSize: 10, color: '#FFF' }}>
                        {ahiData.status.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.thresholdsGrid}>
                    <View style={styles.thresholdRow}>
                      <Text style={styles.thresholdName}>Indice AHI (Apnee/Ora):</Text>
                      <Text style={[styles.thresholdVal, { fontSize: 16, color: '#47C1B0' }]}>{ahiData.ahi_index}</Text>
                    </View>
                    <View style={styles.thresholdRow}>
                      <Text style={styles.thresholdName}>Apnee Rilevate (ultime 24h):</Text>
                      <Text style={styles.thresholdVal}>{ahiData.apnea_count}</Text>
                    </View>
                    <View style={styles.thresholdRow}>
                      <Text style={styles.thresholdName}>Ore Monitoraggio Attivo:</Text>
                      <Text style={styles.thresholdVal}>{ahiData.hours} ore</Text>
                    </View>
                  </View>
                </View>
              )}

              {/* ALERTS SECTION */}
              <View style={styles.alertsCard}>
                <Text style={styles.cardSectionTitle}>Allarmi e Anomalie Rilevate</Text>
                {alerts.filter((a) => !a.is_resolved).length === 0 ? (
                  <Text style={styles.noAlertsText}>Nessuna anomalia riscontrata. Il neonato riposa tranquillo.</Text>
                ) : (
                  alerts.filter((a) => !a.is_resolved).map((alert) => (
                    <View key={alert.id} style={[
                      styles.alertItem,
                      alert.severity === 'critical' ? styles.alertCritical : alert.severity === 'high' ? styles.alertHigh : styles.alertNormal
                    ]}>
                      <View style={styles.alertHeaderRow}>
                        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                          <Text style={styles.alertType}>{alert.type}</Text>
                          <View style={[
                            styles.alertSeverityBadge,
                            alert.severity === 'critical' ? styles.badgeCritical : alert.severity === 'high' ? styles.badgeHigh : styles.badgeNormal
                          ]}>
                            <Text style={styles.alertSeverityBadgeText}>
                              {alert.severity.toUpperCase()}
                            </Text>
                          </View>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 8 }}>
                          {alert.is_resolved ? (
                            <View style={styles.resolvedBadge}>
                              <Text style={styles.resolvedBadgeText}>RISOLTO</Text>
                            </View>
                          ) : (
                            role === 'parent' && (
                              <TouchableOpacity
                                style={styles.resolveBtn}
                                onPress={() => handleResolveAlert(alert.id)}
                              >
                                <Text style={styles.resolveBtnText}>Presa in Carico</Text>
                              </TouchableOpacity>
                            )
                          )}
                        </View>
                      </View>
                      <Text style={styles.alertMsg}>{alert.message}</Text>
                      <Text style={styles.alertTime}>
                        {new Date(alert.timestamp.endsWith('Z') ? alert.timestamp : alert.timestamp + 'Z').toLocaleTimeString()} - {new Date(alert.timestamp.endsWith('Z') ? alert.timestamp : alert.timestamp + 'Z').toLocaleDateString()}
                      </Text>
                    </View>
                  ))
                )}
              </View>

              {/* ONLY FOR PARENT: MEDICAL ACRONYMS LEGEND */}
              {role === 'parent' && (
                <View style={styles.legendCard}>
                  <TouchableOpacity
                    onPress={() => setLegendExpanded(!legendExpanded)}
                    style={styles.legendHeader}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.cardSectionTitle}>📘 Glossario termini tecnici</Text>
                    <Text style={styles.legendToggleIcon}>{legendExpanded ? '▲' : '▼'}</Text>
                  </TouchableOpacity>

                  {legendExpanded && (
                    <View style={{ marginTop: 12 }}>
                      <Text style={styles.legendSubtitle}>
                        Questa guida ti aiuta a comprendere il significato dei parametri clinici e degli allarmi rilevati dal sistema.
                      </Text>

                      <View style={styles.legendItem}>
                        <Text style={styles.legendTerm}>SIDS (Sudden Infant Death Syndrome)</Text>
                        <Text style={styles.legendDesc}>
                          Sindrome della morte improvvisa del lattante. Il sistema monitora la posizione prona (a pancia in giù) e la mancanza prolungata di respiro (apnea) proprio per prevenire e minimizzare questo rischio.
                        </Text>
                      </View>

                      <View style={styles.legendItem}>
                        <Text style={styles.legendTerm}>ALTE (Apparent Life-Threatening Event)</Text>
                        <Text style={styles.legendDesc}>
                          Episodio di apparente minaccia per la vita. Si verifica quando una pausa respiratoria (apnea) si associa a un forte rallentamento del battito cardiaco (bradicardia) e a rilassamento muscolare (ipotonia). Richiede immediata attenzione.
                        </Text>
                      </View>

                      <View style={styles.legendItem}>
                        <Text style={styles.legendTerm}>IPOTONIA</Text>
                        <Text style={styles.legendDesc}>
                          Diminuzione insolita del tono muscolare (il neonato appare insolitamente debole o privo di tono). Viene monitorato tramite i sensori di movimento della maglietta.
                        </Text>
                      </View>

                      <View style={styles.legendItem}>
                        <Text style={styles.legendTerm}>APNEA</Text>
                        <Text style={styles.legendDesc}>
                          Interruzione temporanea della respirazione (pausa del respiro) per un tempo superiore ai 10-20 secondi.
                        </Text>
                      </View>

                      <View style={styles.legendItem}>
                        <Text style={styles.legendTerm}>BRADICARDIA / TACHICARDIA</Text>
                        <Text style={styles.legendDesc}>
                          Frequenza cardiaca rispettivamente troppo bassa (bradicardia) o troppo alta (tachicardia) rispetto alle soglie di sicurezza stabilite dal pediatra.
                        </Text>
                      </View>

                      <View style={styles.legendItem}>
                        <Text style={styles.legendTerm}>IPOTERMIA / IPERTERMIA</Text>
                        <Text style={styles.legendDesc}>
                          Temperatura corporea cutanea rispettivamente troppo bassa (ipotermia) o troppo alta/in aumento costante (ipertermia/surriscaldamento). Un surriscaldamento corporeo è un noto fattore di rischio per la SIDS.
                        </Text>
                      </View>
                    </View>
                  )}
                </View>
              )}
            </ScrollView>
          ) : (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>
                {role === 'doctor'
                  ? 'Seleziona un neonato per monitorare i suoi dati clinici.'
                  : 'Registra la maglietta intelligente del tuo bambino per visualizzare i dati real-time.'}
              </Text>
              {role === 'parent' && (
                <TouchableOpacity onPress={() => setShowAddBabyModal(true)} style={styles.emptyAddBabyBtn}>
                  <Text style={styles.emptyAddBabyBtnText}>➕ Associa Nuova Smart Shirt</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      )}

      {/* THRESHOLD EDIT DIALOG (DOCTOR ONLY) */}
      <Modal visible={editThresholdsModal} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }}
            keyboardShouldPersistTaps="handled"
            style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
          >
            <View style={[styles.modalCard, { maxHeight: undefined }]}>
              <Text style={styles.modalTitle}>🩺 Modifica Soglie Mediche</Text>

              {/* HR MIN SLIDER */}
              <View style={styles.sliderContainer}>
                <View style={styles.sliderLabelRow}>
                  <Text style={styles.modalLabel}>Battito Cardiaco Minimo:</Text>
                  <Text style={styles.sliderValueText}>{tempHrMin || '0'} BPM</Text>
                </View>
                <Slider
                  minimumValue={50}
                  maximumValue={120}
                  value={Number(tempHrMin) || 60}
                  onValueChange={(val) => setTempHrMin(String(Math.round(val)))}
                  step={1}
                  minimumTrackTintColor="#47C1B0"
                  maximumTrackTintColor="#333"
                  thumbTintColor="#47C1B0"
                  style={styles.sliderComponent}
                />
                <View style={styles.sliderLimitsRow}>
                  <Text style={styles.sliderLimitText}>50 BPM</Text>
                  <Text style={styles.sliderLimitText}>120 BPM</Text>
                </View>
              </View>

              {/* HR MAX SLIDER */}
              <View style={styles.sliderContainer}>
                <View style={styles.sliderLabelRow}>
                  <Text style={styles.modalLabel}>Battito Cardiaco Massimo:</Text>
                  <Text style={styles.sliderValueText}>{tempHrMax || '0'} BPM</Text>
                </View>
                <Slider
                  minimumValue={100}
                  maximumValue={220}
                  value={Number(tempHrMax) || 160}
                  onValueChange={(val) => setTempHrMax(String(Math.round(val)))}
                  step={1}
                  minimumTrackTintColor="#47C1B0"
                  maximumTrackTintColor="#333"
                  thumbTintColor="#47C1B0"
                  style={styles.sliderComponent}
                />
                <View style={styles.sliderLimitsRow}>
                  <Text style={styles.sliderLimitText}>100 BPM</Text>
                  <Text style={styles.sliderLimitText}>220 BPM</Text>
                </View>
              </View>

              {/* TEMP MIN SLIDER */}
              <View style={styles.sliderContainer}>
                <View style={styles.sliderLabelRow}>
                  <Text style={styles.modalLabel}>Temperatura Minima:</Text>
                  <Text style={styles.sliderValueText}>{Number(tempTempMin || 36.0).toFixed(1)} °C</Text>
                </View>
                <Slider
                  minimumValue={34.0}
                  maximumValue={37.0}
                  value={Number(tempTempMin) || 36.0}
                  onValueChange={(val) => setTempTempMin(String(val.toFixed(1)))}
                  step={0.1}
                  minimumTrackTintColor="#47C1B0"
                  maximumTrackTintColor="#333"
                  thumbTintColor="#47C1B0"
                  style={styles.sliderComponent}
                />
                <View style={styles.sliderLimitsRow}>
                  <Text style={styles.sliderLimitText}>34.0 °C</Text>
                  <Text style={styles.sliderLimitText}>37.0 °C</Text>
                </View>
              </View>

              {/* TEMP MAX SLIDER */}
              <View style={styles.sliderContainer}>
                <View style={styles.sliderLabelRow}>
                  <Text style={styles.modalLabel}>Temperatura Massima:</Text>
                  <Text style={styles.sliderValueText}>{Number(tempTempMax || 37.5).toFixed(1)} °C</Text>
                </View>
                <Slider
                  minimumValue={37.0}
                  maximumValue={41.0}
                  value={Number(tempTempMax) || 37.5}
                  onValueChange={(val) => setTempTempMax(String(val.toFixed(1)))}
                  step={0.1}
                  minimumTrackTintColor="#47C1B0"
                  maximumTrackTintColor="#333"
                  thumbTintColor="#47C1B0"
                  style={styles.sliderComponent}
                />
                <View style={styles.sliderLimitsRow}>
                  <Text style={styles.sliderLimitText}>37.0 °C</Text>
                  <Text style={styles.sliderLimitText}>41.0 °C</Text>
                </View>
              </View>

              {/* BR MIN SLIDER */}
              <View style={styles.sliderContainer}>
                <View style={styles.sliderLabelRow}>
                  <Text style={styles.modalLabel}>Respiro Minimo:</Text>
                  <Text style={styles.sliderValueText}>{tempBrMin || '0'} atti/min</Text>
                </View>
                <Slider
                  minimumValue={10}
                  maximumValue={40}
                  value={Number(tempBrMin) || 20}
                  onValueChange={(val) => setTempBrMin(String(Math.round(val)))}
                  step={1}
                  minimumTrackTintColor="#47C1B0"
                  maximumTrackTintColor="#333"
                  thumbTintColor="#47C1B0"
                  style={styles.sliderComponent}
                />
                <View style={styles.sliderLimitsRow}>
                  <Text style={styles.sliderLimitText}>10/min</Text>
                  <Text style={styles.sliderLimitText}>40/min</Text>
                </View>
              </View>

              {/* BR MAX SLIDER */}
              <View style={styles.sliderContainer}>
                <View style={styles.sliderLabelRow}>
                  <Text style={styles.modalLabel}>Respiro Massimo:</Text>
                  <Text style={styles.sliderValueText}>{tempBrMax || '0'} atti/min</Text>
                </View>
                <Slider
                  minimumValue={30}
                  maximumValue={80}
                  value={Number(tempBrMax) || 60}
                  onValueChange={(val) => setTempBrMax(String(Math.round(val)))}
                  step={1}
                  minimumTrackTintColor="#47C1B0"
                  maximumTrackTintColor="#333"
                  thumbTintColor="#47C1B0"
                  style={styles.sliderComponent}
                />
                <View style={styles.sliderLimitsRow}>
                  <Text style={styles.sliderLimitText}>30/min</Text>
                  <Text style={styles.sliderLimitText}>80/min</Text>
                </View>
              </View>

              <View style={styles.modalActions}>
                <TouchableOpacity onPress={() => setEditThresholdsModal(false)} style={styles.modalCancelBtn}>
                  <Text style={styles.modalCancelBtnText}>Annulla</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleUpdateThresholds} style={styles.modalSaveBtn}>
                  <Text style={styles.modalSaveBtnText}>Salva</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* ADD BABY DIALOG (PARENT ONLY) */}
      <Modal visible={showAddBabyModal} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }}
            keyboardShouldPersistTaps="handled"
            style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
          >
            <View style={[styles.modalCard, { maxHeight: undefined }]}>
              <Text style={styles.modalTitle}>👶 Associa Nuova Maglietta</Text>

              <Text style={styles.modalLabel}>Nome del Bambino:</Text>
              <TextInput
                style={[styles.modalInput, babyErrors.firstName && styles.inputError]}
                value={babyFirstName}
                onChangeText={(text) => {
                  setBabyFirstName(text);
                  if (babyErrors.firstName) setBabyErrors(prev => ({ ...prev, firstName: '' }));
                }}
                placeholder="es. Mario"
                placeholderTextColor="#888"
              />
              {babyErrors.firstName ? (
                <Text style={styles.errorText}>{babyErrors.firstName}</Text>
              ) : null}

              <Text style={styles.modalLabel}>Cognome del Bambino:</Text>
              <TextInput
                style={[styles.modalInput, babyErrors.lastName && styles.inputError]}
                value={babyLastName}
                onChangeText={(text) => {
                  setBabyLastName(text);
                  if (babyErrors.lastName) setBabyErrors(prev => ({ ...prev, lastName: '' }));
                }}
                placeholder="es. Rossi"
                placeholderTextColor="#888"
              />
              {babyErrors.lastName ? (
                <Text style={styles.errorText}>{babyErrors.lastName}</Text>
              ) : null}

              <Text style={styles.modalLabel}>ID Smart Shirt (ID Maglietta):</Text>
              <TextInput
                style={[styles.modalInput, babyErrors.deviceId && styles.inputError]}
                value={babyDeviceId}
                onChangeText={(text) => {
                  setBabyDeviceId(text);
                  if (babyErrors.deviceId) setBabyErrors(prev => ({ ...prev, deviceId: '' }));
                }}
                placeholder="es. MAG_001"
                placeholderTextColor="#888"
              />
              {babyErrors.deviceId ? (
                <Text style={styles.errorText}>{babyErrors.deviceId}</Text>
              ) : null}

              <Text style={styles.modalLabel}>Sesso del Bambino:</Text>
              <View style={styles.roleTabRow}>
                <TouchableOpacity
                  style={[styles.roleTab, babyGender === 'M' && styles.roleTabActive]}
                  onPress={() => setBabyGender('M')}
                >
                  <Text style={[styles.roleTabText, babyGender === 'M' && styles.roleTabTextActive]}>💎 Maschio</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.roleTab, babyGender === 'F' && styles.roleTabActive]}
                  onPress={() => setBabyGender('F')}
                >
                  <Text style={[styles.roleTabText, babyGender === 'F' && styles.roleTabTextActive]}>🌸 Femmina</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.modalLabel}>Età del Bambino (mesi):</Text>
              <TextInput
                style={[styles.modalInput, babyErrors.age && styles.inputError]}
                value={babyAge}
                onChangeText={(text) => {
                  setBabyAge(text);
                  if (babyErrors.age) setBabyErrors(prev => ({ ...prev, age: '' }));
                }}
                placeholder="es. 6"
                placeholderTextColor="#888"
                keyboardType="numeric"
              />
              {babyErrors.age ? (
                <Text style={styles.errorText}>{babyErrors.age}</Text>
              ) : null}

              <Text style={styles.modalLabel}>Età Gestazionale alla Nascita (settimane):</Text>
              <TextInput
                style={[styles.modalInput, babyErrors.gestationalAge && styles.inputError]}
                value={babyGestationalAge}
                onChangeText={(text) => {
                  setBabyGestationalAge(text);
                  if (babyErrors.gestationalAge) setBabyErrors(prev => ({ ...prev, gestationalAge: '' }));
                }}
                placeholder="es. 38.5 (default 40.0)"
                placeholderTextColor="#888"
                keyboardType="numeric"
              />
              {babyErrors.gestationalAge ? (
                <Text style={styles.errorText}>{babyErrors.gestationalAge}</Text>
              ) : null}

              <Text style={styles.modalLabel}>Altezza del Bambino (cm):</Text>
              <TextInput
                style={[styles.modalInput, babyErrors.height && styles.inputError]}
                value={babyHeight}
                onChangeText={(text) => {
                  setBabyHeight(text);
                  if (babyErrors.height) setBabyErrors(prev => ({ ...prev, height: '' }));
                }}
                placeholder="es. 65"
                placeholderTextColor="#888"
                keyboardType="numeric"
              />
              {babyErrors.height ? (
                <Text style={styles.errorText}>{babyErrors.height}</Text>
              ) : null}

              <Text style={styles.modalLabel}>Peso del Bambino (kg):</Text>
              <TextInput
                style={[styles.modalInput, babyErrors.weight && styles.inputError]}
                value={babyWeight}
                onChangeText={(text) => {
                  setBabyWeight(text);
                  if (babyErrors.weight) setBabyErrors(prev => ({ ...prev, weight: '' }));
                }}
                placeholder="es. 7.5"
                placeholderTextColor="#888"
                keyboardType="numeric"
              />
              {babyErrors.weight ? (
                <Text style={styles.errorText}>{babyErrors.weight}</Text>
              ) : null}

              <Text style={styles.modalLabel}>Pediatra di Riferimento:</Text>
              <ScrollView style={styles.doctorSelectorList} nestedScrollEnabled={true}>
                {doctorsList.map((doc) => (
                  <TouchableOpacity
                    key={doc.id}
                    style={[
                      styles.doctorSelectBadge,
                      selectedDoctorId === doc.id && styles.doctorSelectBadgeActive,
                      babyErrors.doctorId && styles.inputError
                    ]}
                    onPress={() => {
                      setSelectedDoctorId(doc.id);
                      if (babyErrors.doctorId) setBabyErrors(prev => ({ ...prev, doctorId: '' }));
                    }}
                  >
                    <Text style={[
                      styles.doctorSelectText,
                      selectedDoctorId === doc.id && styles.doctorSelectTextActive
                    ]}>
                      🩺 Dott. {doc.first_name || doc.username} {doc.last_name || ''}
                    </Text>
                  </TouchableOpacity>
                ))}
                {doctorsList.length === 0 && (
                  <Text style={styles.noDoctorsText}>Nessun pediatra registrato nel sistema.</Text>
                )}
              </ScrollView>
              {babyErrors.doctorId ? (
                <Text style={styles.errorText}>{babyErrors.doctorId}</Text>
              ) : null}

              <View style={styles.modalActions}>
                <TouchableOpacity onPress={() => { setShowAddBabyModal(false); setBabyErrors({}); }} style={styles.modalCancelBtn} disabled={babyLoading}>
                  <Text style={styles.modalCancelBtnText}>Annulla</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleAddBaby} style={styles.modalSaveBtn} disabled={babyLoading}>
                  {babyLoading ? (
                    <ActivityIndicator color="#000" size="small" />
                  ) : (
                    <Text style={styles.modalSaveBtnText}>Registra</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* MODAL: MODIFICA PROFILO BAMBINO */}
      <Modal visible={showEditBabyModal} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }}
            keyboardShouldPersistTaps="handled"
            style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
          >
            <View style={[styles.modalCard, { maxHeight: undefined }]}>
              <Text style={styles.modalTitle}>✏️ Modifica Profilo Neonato</Text>
              
              <Text style={styles.modalLabel}>Nome del Bambino:</Text>
              <TextInput
                style={[styles.modalInput, babyErrors.firstName && styles.inputError]}
                value={babyFirstName}
                onChangeText={(text) => {
                  setBabyFirstName(text);
                  if (babyErrors.firstName) setBabyErrors(prev => ({ ...prev, firstName: '' }));
                }}
                placeholder="es. Luca"
                placeholderTextColor="#888"
              />
              {babyErrors.firstName ? (
                <Text style={styles.errorText}>{babyErrors.firstName}</Text>
              ) : null}

              <Text style={styles.modalLabel}>Cognome del Bambino:</Text>
              <TextInput
                style={[styles.modalInput, babyErrors.lastName && styles.inputError]}
                value={babyLastName}
                onChangeText={(text) => {
                  setBabyLastName(text);
                  if (babyErrors.lastName) setBabyErrors(prev => ({ ...prev, lastName: '' }));
                }}
                placeholder="es. Rossi"
                placeholderTextColor="#888"
              />
              {babyErrors.lastName ? (
                <Text style={styles.errorText}>{babyErrors.lastName}</Text>
              ) : null}

              <Text style={styles.modalLabel}>Sesso del Bambino:</Text>
              <View style={styles.roleTabRow}>
                <TouchableOpacity
                  style={[styles.roleTab, babyGender === 'M' && styles.roleTabActive]}
                  onPress={() => setBabyGender('M')}
                >
                  <Text style={[styles.roleTabText, babyGender === 'M' && styles.roleTabTextActive]}>💎 Maschio</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.roleTab, babyGender === 'F' && styles.roleTabActive]}
                  onPress={() => setBabyGender('F')}
                >
                  <Text style={[styles.roleTabText, babyGender === 'F' && styles.roleTabTextActive]}>🌸 Femmina</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.modalLabel}>Età del Bambino (mesi):</Text>
              <TextInput
                style={[styles.modalInput, babyErrors.age && styles.inputError]}
                value={babyAge}
                onChangeText={(text) => {
                  setBabyAge(text);
                  if (babyErrors.age) setBabyErrors(prev => ({ ...prev, age: '' }));
                }}
                placeholder="es. 6"
                placeholderTextColor="#888"
                keyboardType="numeric"
              />
              {babyErrors.age ? (
                <Text style={styles.errorText}>{babyErrors.age}</Text>
              ) : null}

              <Text style={styles.modalLabel}>Età Gestazionale alla Nascita (settimane):</Text>
              <TextInput
                style={[styles.modalInput, babyErrors.gestationalAge && styles.inputError]}
                value={babyGestationalAge}
                onChangeText={(text) => {
                  setBabyGestationalAge(text);
                  if (babyErrors.gestationalAge) setBabyErrors(prev => ({ ...prev, gestationalAge: '' }));
                }}
                placeholder="es. 38.5 (default 40.0)"
                placeholderTextColor="#888"
                keyboardType="numeric"
              />
              {babyErrors.gestationalAge ? (
                <Text style={styles.errorText}>{babyErrors.gestationalAge}</Text>
              ) : null}

              <Text style={styles.modalLabel}>Altezza del Bambino (cm):</Text>
              <TextInput
                style={[styles.modalInput, babyErrors.height && styles.inputError]}
                value={babyHeight}
                onChangeText={(text) => {
                  setBabyHeight(text);
                  if (babyErrors.height) setBabyErrors(prev => ({ ...prev, height: '' }));
                }}
                placeholder="es. 65"
                placeholderTextColor="#888"
                keyboardType="numeric"
              />
              {babyErrors.height ? (
                <Text style={styles.errorText}>{babyErrors.height}</Text>
              ) : null}

              <Text style={styles.modalLabel}>Peso del Bambino (kg):</Text>
              <TextInput
                style={[styles.modalInput, babyErrors.weight && styles.inputError]}
                value={babyWeight}
                onChangeText={(text) => {
                  setBabyWeight(text);
                  if (babyErrors.weight) setBabyErrors(prev => ({ ...prev, weight: '' }));
                }}
                placeholder="es. 7.5"
                placeholderTextColor="#888"
                keyboardType="numeric"
              />
              {babyErrors.weight ? (
                <Text style={styles.errorText}>{babyErrors.weight}</Text>
              ) : null}

              <Text style={styles.modalLabel}>Pediatra di Riferimento:</Text>
              <ScrollView style={styles.doctorSelectorList} nestedScrollEnabled={true}>
                {doctorsList.map((doc) => (
                  <TouchableOpacity
                    key={doc.id}
                    style={[
                      styles.doctorSelectBadge,
                      selectedDoctorId === doc.id && styles.doctorSelectBadgeActive,
                      babyErrors.doctorId && styles.inputError
                    ]}
                    onPress={() => {
                      setSelectedDoctorId(doc.id);
                      if (babyErrors.doctorId) setBabyErrors(prev => ({ ...prev, doctorId: '' }));
                    }}
                  >
                    <Text style={[
                      styles.doctorSelectText,
                      selectedDoctorId === doc.id && styles.doctorSelectTextActive
                    ]}>
                      🩺 Dott. {doc.first_name || doc.username} {doc.last_name || ''}
                    </Text>
                  </TouchableOpacity>
                ))}
                {doctorsList.length === 0 && (
                  <Text style={styles.noDoctorsText}>Nessun pediatra registrato nel sistema.</Text>
                )}
              </ScrollView>
              {babyErrors.doctorId ? (
                <Text style={styles.errorText}>{babyErrors.doctorId}</Text>
              ) : null}

              <View style={styles.modalActions}>
                <TouchableOpacity onPress={() => { setShowEditBabyModal(false); setBabyErrors({}); }} style={styles.modalCancelBtn} disabled={babyLoading}>
                  <Text style={styles.modalCancelBtnText}>Annulla</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleUpdateBaby} style={styles.modalSaveBtn} disabled={babyLoading}>
                  {babyLoading ? (
                    <ActivityIndicator color="#000" size="small" />
                  ) : (
                    <Text style={styles.modalSaveBtnText}>Salva</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
      <Text style={{ color: '#555', fontSize: 10, textAlign: 'center', marginVertical: 4 }}>
        Versione 2.0.9 (Legenda Clinica & Alert Riformattati)
      </Text>
    </SafeAreaView>
  );
}

// =====================================================================
//  DESIGN SYSTEM  ·  BabyGuard IoMT  ·  Premium Medical Dark Theme
//  Palette centralizzata + helper per ombre morbide (iOS + Android).
//  Nessuna logica: solo token visivi riutilizzati nello StyleSheet.
// =====================================================================
const C = {
  bg: '#081522',           // sfondo app, profondo
  surface: '#12293C',      // card principali (coincide con lo sfondo del grafico ECG)
  panel: '#0F2434',        // pannelli/chip secondari
  field: '#0A1B2A',        // input
  border: '#1C3A52',       // bordi neutri
  borderSoft: 'rgba(71,193,176,0.16)', // bordi semitrasparenti per profondità
  mint: '#47C1B0',         // accento primario (verde menta del logo)
  mintBright: '#5FD8C5',
  mintTint: 'rgba(71,193,176,0.12)',
  red: '#FF5C6C',          // critico, soffuso
  redTint: 'rgba(255,92,108,0.10)',
  redBorder: 'rgba(255,92,108,0.28)',
  orange: '#FFB25A',       // allarme alto, caldo
  orangeTint: 'rgba(255,178,90,0.10)',
  orangeBorder: 'rgba(255,178,90,0.28)',
  green: '#54CF7B',        // stato ok
  greenTint: 'rgba(84,207,123,0.10)',
  greenBorder: 'rgba(84,207,123,0.28)',
  blue: '#4FA9E2',         // info
  blueTint: 'rgba(79,169,226,0.10)',
  blueBorder: 'rgba(79,169,226,0.28)',
  text: '#EEF4F9',         // testo primario
  textDim: '#9DB1C1',      // testo secondario
  textMuted: '#647C8E',    // testo terziario / placeholder
  onAccent: '#04181C',     // testo su sfondo menta
};

// Ombre morbide e diffuse (profondità senza durezza)
const softShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 10 },
  shadowOpacity: 0.38,
  shadowRadius: 18,
  elevation: 9,
};
const subtleShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.24,
  shadowRadius: 10,
  elevation: 5,
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },

  // ---------- HEADER ----------
  header: {
    height: 76,
    backgroundColor: C.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: C.borderSoft,
    ...subtleShadow,
  },
  headerTitle: {
    fontSize: 21,
    fontWeight: '800',
    color: C.mint,
    letterSpacing: 0.2,
  },
  headerSub: {
    fontSize: 12,
    color: C.textMuted,
    marginTop: 2,
    fontWeight: '500',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  configBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: C.panel,
    borderWidth: 1,
    borderColor: C.border,
  },
  configBtnText: {
    color: C.textDim,
    fontSize: 12,
    fontWeight: '600',
  },
  logoutBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: C.redTint,
    borderWidth: 1,
    borderColor: C.redBorder,
  },
  logoutBtnText: {
    color: C.red,
    fontSize: 12,
    fontWeight: '700',
  },

  // ---------- CONFIG DRAWER ----------
  configDrawer: {
    backgroundColor: C.surface,
    padding: 18,
    borderBottomWidth: 1,
    borderBottomColor: C.borderSoft,
    ...subtleShadow,
  },
  configLabel: {
    color: C.text,
    fontSize: 15,
    fontWeight: '700',
  },
  ipInputRow: {
    flexDirection: 'row',
    gap: 10,
  },
  ipInput: {
    flex: 1,
    backgroundColor: C.field,
    borderRadius: 12,
    height: 46,
    paddingHorizontal: 14,
    color: C.text,
    fontSize: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  saveIpBtn: {
    backgroundColor: C.mint,
    borderRadius: 12,
    paddingHorizontal: 18,
    justifyContent: 'center',
  },
  saveIpBtnText: {
    color: C.onAccent,
    fontWeight: '700',
  },
  drawerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  closeDrawerBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: C.redTint,
    borderWidth: 1,
    borderColor: C.redBorder,
  },
  closeDrawerText: {
    color: C.red,
    fontSize: 12,
    fontWeight: '700',
  },
  configSection: {
    marginBottom: 10,
  },
  configSubLabel: {
    color: C.text,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 10,
  },
  telegramStatusCard: {
    backgroundColor: C.panel,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: C.borderSoft,
  },
  telegramStatusText: {
    color: C.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 6,
  },
  telegramSubText: {
    color: C.textMuted,
    fontSize: 11,
    marginBottom: 10,
  },
  telegramInfoText: {
    color: C.textDim,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 14,
  },
  telegramLinkBtn: {
    backgroundColor: C.blue,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    ...subtleShadow,
  },
  telegramLinkBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  telegramUnlinkBtn: {
    backgroundColor: C.redTint,
    borderWidth: 1,
    borderColor: C.redBorder,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 12,
  },
  telegramUnlinkBtnText: {
    color: C.red,
    fontSize: 12,
    fontWeight: '700',
  },
  telegramCodeContainer: {
    marginTop: 12,
    alignItems: 'center',
    backgroundColor: C.field,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: C.borderSoft,
  },
  telegramCodeLabel: {
    color: C.textMuted,
    fontSize: 11,
    marginBottom: 6,
  },
  telegramCode: {
    color: C.mintBright,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 4,
    marginVertical: 6,
  },
  telegramInstructions: {
    color: C.textDim,
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'left',
    width: '100%',
    marginTop: 8,
    marginBottom: 12,
  },
  telegramVerifyBtn: {
    backgroundColor: C.mint,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    width: '100%',
  },
  telegramVerifyBtnText: {
    color: C.onAccent,
    fontSize: 12,
    fontWeight: '700',
  },

  // ---------- AUTH ----------
  authContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 28,
  },
  authCard: {
    backgroundColor: C.surface,
    borderRadius: 24,
    padding: 28,
    borderWidth: 1,
    borderColor: C.borderSoft,
    ...softShadow,
  },
  authTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: C.text,
    textAlign: 'center',
    marginBottom: 24,
    letterSpacing: 0.3,
  },
  roleTabRow: {
    flexDirection: 'row',
    backgroundColor: C.field,
    borderRadius: 14,
    padding: 5,
    marginBottom: 22,
    borderWidth: 1,
    borderColor: C.border,
  },
  roleTab: {
    flex: 1,
    paddingVertical: 11,
    alignItems: 'center',
    borderRadius: 10,
  },
  roleTabActive: {
    backgroundColor: C.mint,
    ...subtleShadow,
  },
  roleTabText: {
    color: C.textMuted,
    fontWeight: '700',
    fontSize: 14,
  },
  roleTabTextActive: {
    color: C.onAccent,
  },
  authInput: {
    backgroundColor: C.field,
    borderRadius: 14,
    height: 52,
    paddingHorizontal: 16,
    color: C.text,
    fontSize: 15,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: C.border,
  },
  authBtn: {
    backgroundColor: C.mint,
    height: 52,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
    ...subtleShadow,
  },
  authBtnText: {
    color: C.onAccent,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 1,
  },
  authToggle: {
    marginTop: 20,
    alignItems: 'center',
  },
  authToggleText: {
    color: C.mint,
    fontSize: 14,
    fontWeight: '600',
  },

  // ---------- PICKER / SELECTION ----------
  pickerSection: {
    padding: 18,
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.borderSoft,
  },
  searchInput: {
    backgroundColor: C.field,
    borderRadius: 14,
    height: 46,
    paddingHorizontal: 16,
    color: C.text,
    fontSize: 14,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 16,
  },
  pickerHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  addBabyBtn: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    backgroundColor: C.mintTint,
    borderWidth: 1,
    borderColor: C.mint,
    borderRadius: 10,
  },
  addBabyBtnText: {
    color: C.mint,
    fontSize: 11,
    fontWeight: '700',
  },
  sectionLabel: {
    color: C.textMuted,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  neonateScroll: {
    flexDirection: 'row',
  },
  neonateBadge: {
    backgroundColor: C.panel,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 22,
    marginRight: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  neonateBadgeActive: {
    backgroundColor: C.mint,
    borderColor: C.mint,
    ...subtleShadow,
  },
  neonateBadgeText: {
    color: C.textDim,
    fontWeight: '600',
  },
  neonateBadgeTextActive: {
    color: C.onAccent,
    fontWeight: '700',
  },
  noNeonates: {
    color: C.textMuted,
    fontStyle: 'italic',
    paddingVertical: 6,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
  },
  deviceInfoText: {
    color: C.textDim,
    fontSize: 12,
  },
  statusBadge: {
    paddingVertical: 5,
    paddingHorizontal: 11,
    borderRadius: 20,
    fontSize: 11,
    fontWeight: '700',
    overflow: 'hidden',
  },
  // Dual-purpose: badge "Live" + badge stato AHI (testo bianco figlio) → sfondo solido leggibile
  statusLive: {
    backgroundColor: '#16432A',
    color: C.green,
  },
  statusDisconnected: {
    backgroundColor: '#4A1822',
    color: C.red,
  },

  // ---------- SCROLL CONTENT ----------
  scrollContent: {
    flex: 1,
    padding: 16, // VINCOLO larghezza grafico: non modificare
  },

  // ---------- BABY BIO CHIPS ----------
  babyBioContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: C.surface,
    borderRadius: 18,
    padding: 14,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: C.borderSoft,
    gap: 8,
    ...subtleShadow,
  },
  bioChip: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: C.field,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: C.border,
  },
  bioChipLabel: {
    fontSize: 9,
    color: C.textMuted,
    textTransform: 'uppercase',
    fontWeight: '700',
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  bioChipValue: {
    fontSize: 13,
    color: C.text,
    fontWeight: '700',
  },

  // ---------- LIVE VALUES GRID ----------
  liveGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12, // VINCOLO: non modificare (calcolo larghezza card)
    marginBottom: 18,
  },
  liveCard: {
    width: (Dimensions.get('window').width - 44) / 2, // VINCOLO: non modificare
    borderRadius: 20,
    padding: 14,
    height: 130,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    ...subtleShadow,
  },
  cardHr: {
    backgroundColor: C.redTint,
    borderColor: C.redBorder,
  },
  cardTemp: {
    backgroundColor: C.orangeTint,
    borderColor: C.orangeBorder,
  },
  cardBr: {
    backgroundColor: C.blueTint,
    borderColor: C.blueBorder,
  },
  cardPos: {
    backgroundColor: C.mintTint,
    borderColor: C.mint,
  },
  cardEmoji: {
    fontSize: 26,
  },
  cardVal: {
    fontSize: 36,
    fontWeight: '800',
    color: C.text,
    marginVertical: 4,
    letterSpacing: -0.5,
  },
  cardValSmall: {
    fontSize: 17,
    fontWeight: '700',
    color: C.text,
    textAlign: 'center',
    marginVertical: 8,
  },
  cardUnit: {
    fontSize: 12,
    color: C.textDim,
    fontWeight: '500',
  },
  cardTitle: {
    fontSize: 12,
    color: C.textMuted,
    marginTop: 6,
    fontWeight: '600',
  },
  cardFlipped: {
    alignItems: 'stretch',
    justifyContent: 'flex-start',
  },
  cardContainer: {
    width: (Dimensions.get('window').width - 44) / 2,
    height: 130,
    position: 'relative',
  },
  cardTouchWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.field,
    borderRadius: 14,
    height: 52,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: C.border,
    paddingRight: 14,
  },
  passwordInput: {
    flex: 1,
    height: '100%',
    paddingHorizontal: 16,
    color: C.text,
    fontSize: 15,
  },
  eyeButton: {
    padding: 4,
  },
  eyeIcon: {
    fontSize: 18,
    color: C.textMuted,
  },
  cardFrontHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
  cardTapPrompt: {
    fontSize: 10,
    color: C.textMuted,
    opacity: 0.6,
  },
  cardBackHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginBottom: 6,
  },
  cardBackTitle: {
    color: C.text,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    opacity: 0.7,
  },
  cardBackClose: {
    color: C.textMuted,
    fontSize: 10,
    fontWeight: '700',
  },
  emptyHistoryContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 70,
  },
  noHistoryText: {
    color: C.textDim,
    fontSize: 10,
    fontStyle: 'italic',
  },
  historyScroll: {
    flex: 1,
    maxHeight: 75,
  },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  historyVal: {
    color: C.text,
    fontSize: 10,
    fontWeight: '600',
  },
  historyTime: {
    color: C.textMuted,
    fontSize: 8,
  },

  // ---------- ECG CHART CARD ----------
  chartCard: {
    backgroundColor: C.surface, // = sfondo grafico per fusione perfetta
    borderRadius: 20,
    padding: 16, // VINCOLO larghezza grafico: non modificare l'orizzontale
    marginBottom: 18,
    borderWidth: 1,
    borderColor: C.borderSoft,
    ...subtleShadow,
  },
  cardSectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: C.text,
    marginBottom: 14,
    letterSpacing: 0.2,
  },
  chart: {
    marginVertical: 8,
    borderRadius: 16,
    paddingRight: 35,
    backgroundColor: C.surface,
    alignSelf: 'center',
  },
  ecgLegendContainer: {
    marginTop: 12,
    paddingHorizontal: 6,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.borderSoft,
  },
  ecgLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  ecgLegendDotCyan: {
    color: C.mint,
    fontSize: 11,
    marginRight: 10,
  },
  ecgLegendDotRed: {
    color: C.red,
    fontSize: 11,
    marginRight: 10,
  },
  ecgLegendText: {
    fontSize: 12,
    color: C.textDim,
    flex: 1,
    lineHeight: 17,
  },

  // ---------- THRESHOLDS / AHI ----------
  thresholdsCard: {
    backgroundColor: C.surface,
    borderRadius: 20,
    padding: 18,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: C.borderSoft,
    ...subtleShadow,
  },
  thresholdsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  editBtn: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    backgroundColor: C.mintTint,
    borderWidth: 1,
    borderColor: C.mint,
    borderRadius: 10,
  },
  editBtnText: {
    color: C.mint,
    fontSize: 11,
    fontWeight: '700',
  },
  thresholdsGrid: {
    marginTop: 12,
  },
  thresholdRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: C.borderSoft,
  },
  thresholdName: {
    color: C.textDim,
    fontSize: 13,
  },
  thresholdVal: {
    color: C.text,
    fontWeight: '700',
    fontSize: 14,
  },

  // ---------- ALERTS ----------
  alertsCard: {
    backgroundColor: C.surface,
    borderRadius: 20,
    padding: 18,
    marginBottom: 32,
    borderWidth: 1,
    borderColor: C.borderSoft,
    ...subtleShadow,
  },
  legendCard: {
    backgroundColor: C.surface,
    borderRadius: 20,
    padding: 18,
    marginBottom: 32,
    borderWidth: 1,
    borderColor: C.borderSoft,
    ...subtleShadow,
  },
  legendHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  legendToggleIcon: {
    color: C.mint,
    fontSize: 14,
    fontWeight: '700',
  },
  legendSubtitle: {
    color: C.textMuted,
    fontSize: 12,
    marginBottom: 14,
    lineHeight: 18,
  },
  legendItem: {
    borderBottomWidth: 1,
    borderBottomColor: C.borderSoft,
    paddingVertical: 12,
  },
  legendTerm: {
    color: C.mint,
    fontWeight: '700',
    fontSize: 13,
    marginBottom: 6,
  },
  legendDesc: {
    color: C.textDim,
    fontSize: 12,
    lineHeight: 19,
  },
  noAlertsText: {
    color: C.green,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 16,
  },
  alertItem: {
    borderLeftWidth: 4,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  // Dual-purpose: sfondo alert + sfondo badge stato AHI (testo bianco) → tinte solide leggibili
  alertCritical: {
    backgroundColor: '#391823',
    borderLeftColor: C.red,
  },
  alertHigh: {
    backgroundColor: '#3A2916',
    borderLeftColor: C.orange,
  },
  alertNormal: {
    backgroundColor: '#1C3A2C',
    borderLeftColor: C.green,
  },
  alertHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  alertType: {
    color: C.text,
    fontWeight: '700',
    fontSize: 14,
  },
  resolvedBadge: {
    backgroundColor: C.greenTint,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  resolvedBadgeText: {
    color: C.green,
    fontSize: 10,
    fontWeight: '700',
  },
  resolveBtn: {
    backgroundColor: C.mint,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  resolveBtnText: {
    color: C.onAccent,
    fontSize: 10,
    fontWeight: '700',
  },
  alertSeverityBadge: {
    paddingVertical: 2,
    paddingHorizontal: 7,
    borderRadius: 8,
  },
  alertSeverityBadgeText: {
    color: C.onAccent,
    fontSize: 9,
    fontWeight: '800',
  },
  badgeCritical: {
    backgroundColor: C.red,
  },
  badgeHigh: {
    backgroundColor: C.orange,
  },
  badgeNormal: {
    backgroundColor: C.green,
  },
  alertMsg: {
    color: C.text,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 6,
  },
  alertTime: {
    color: C.textMuted,
    fontSize: 10,
    textAlign: 'right',
    marginTop: 4,
  },

  // ---------- EMPTY STATE ----------
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 36,
  },
  emptyText: {
    color: C.textDim,
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 23,
    marginBottom: 28,
  },
  emptyAddBabyBtn: {
    backgroundColor: C.mint,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 14,
    ...subtleShadow,
  },
  emptyAddBabyBtnText: {
    color: C.onAccent,
    fontWeight: '800',
    fontSize: 15,
  },

  // ---------- MODALS ----------
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: C.surface,
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: C.borderSoft,
    maxHeight: '90%',
    ...softShadow,
  },
  modalTitle: {
    fontSize: 19,
    fontWeight: '800',
    color: C.text,
    marginBottom: 20,
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  modalLabel: {
    color: C.textDim,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
  },
  modalInput: {
    backgroundColor: C.field,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    height: 48,
    paddingHorizontal: 14,
    color: C.text,
    fontSize: 15,
    marginBottom: 12,
  },
  doctorSelectorList: {
    maxHeight: 130,
    marginBottom: 12,
  },
  doctorSelectBadge: {
    backgroundColor: C.panel,
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  doctorSelectBadgeActive: {
    backgroundColor: C.mintTint,
    borderColor: C.mint,
  },
  doctorSelectText: {
    color: C.textDim,
    fontSize: 13,
  },
  doctorSelectTextActive: {
    color: C.mint,
    fontWeight: '700',
  },
  noDoctorsText: {
    color: C.red,
    fontSize: 12,
    fontStyle: 'italic',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 20,
  },
  modalCancelBtn: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 12,
    backgroundColor: C.panel,
    borderWidth: 1,
    borderColor: C.border,
  },
  modalCancelBtnText: {
    color: C.textDim,
    fontWeight: '700',
  },
  modalSaveBtn: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 12,
    backgroundColor: C.mint,
    minWidth: 88,
    alignItems: 'center',
    justifyContent: 'center',
    ...subtleShadow,
  },
  modalSaveBtnText: {
    color: C.onAccent,
    fontWeight: '800',
  },

  // ---------- MISC BUTTONS / CARDS ----------
  dissociateBtn: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: C.redTint,
    borderWidth: 1,
    borderColor: C.redBorder,
  },
  dissociateBtnText: {
    color: C.red,
    fontSize: 10,
    fontWeight: '700',
  },
  editNeonateBtn: {
    backgroundColor: C.blueTint,
    borderWidth: 1,
    borderColor: C.blueBorder,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 16,
  },
  editNeonateBtnText: {
    color: C.blue,
    fontWeight: '700',
    fontSize: 13,
  },
  associateCard: {
    backgroundColor: C.surface,
    borderRadius: 20,
    padding: 18,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: C.mintTint,
    ...subtleShadow,
  },
  associateTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: C.mint,
    marginBottom: 10,
  },
  associateDesc: {
    color: C.textDim,
    fontSize: 12,
    lineHeight: 19,
    marginBottom: 14,
  },
  associateInputRow: {
    flexDirection: 'row',
    gap: 10,
  },
  associateInput: {
    flex: 1,
    backgroundColor: C.field,
    borderRadius: 12,
    height: 46,
    paddingHorizontal: 14,
    color: C.text,
    fontSize: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  associateBtnSubmit: {
    backgroundColor: C.mint,
    borderRadius: 12,
    paddingHorizontal: 18,
    justifyContent: 'center',
    ...subtleShadow,
  },
  associateBtnSubmitText: {
    color: C.onAccent,
    fontWeight: '700',
  },
  noDeviceWarningCard: {
    backgroundColor: C.orangeTint,
    borderRadius: 20,
    padding: 18,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: C.orangeBorder,
  },
  warningTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: C.orange,
    marginBottom: 10,
  },
  warningDesc: {
    color: '#E5C9A8',
    fontSize: 12,
    lineHeight: 19,
  },
  inputError: {
    borderColor: C.red,
    borderWidth: 1.5,
  },
  errorText: {
    color: C.red,
    fontSize: 12,
    marginTop: -8, // VINCOLO: aggancia l'errore sotto l'input
    marginBottom: 12,
    marginLeft: 4,
    fontWeight: '500',
  },

  // ---------- SLIDERS ----------
  sliderContainer: {
    marginBottom: 18,
    width: '100%',
  },
  sliderLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  sliderValueText: {
    color: C.mint,
    fontSize: 14,
    fontWeight: '700',
  },
  sliderComponent: {
    width: '100%',
    height: 40,
  },
  sliderLimitsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -4,
    paddingHorizontal: 4,
  },
  sliderLimitText: {
    color: C.textMuted,
    fontSize: 11,
  },
})
