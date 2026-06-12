const DB_NAME = "instant_daily_memo";
const DB_VERSION = 1;
const STORE = "entries";
const AUTOSAVE_MS = 900;
const EVENT_TITLE = "memo";
const GOOGLE_CLIENT_ID_KEY = "instant_daily_memo_google_client_id";
const GOOGLE_CALENDAR_ID_KEY = "instant_daily_memo_google_calendar_id";
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const GOOGLE_DISCOVERY_BASE = "https://www.googleapis.com/calendar/v3";

const dateButton = document.querySelector("#dateButton");
const memoText = document.querySelector("#memoText");
const statusText = document.querySelector("#statusText");
const scrollThumb = document.querySelector("#scrollThumb");
const saveButton = document.querySelector("#saveButton");
const voiceButton = document.querySelector("#voiceButton");
const calendarButton = document.querySelector("#calendarButton");
const settingsButton = document.querySelector("#settingsButton");
const settingsDialog = document.querySelector("#settingsDialog");
const googleStatus = document.querySelector("#googleStatus");
const clientIdInput = document.querySelector("#clientIdInput");
const calendarIdInput = document.querySelector("#calendarIdInput");
const googleSignInButton = document.querySelector("#googleSignInButton");
const googleSignOutButton = document.querySelector("#googleSignOutButton");
const exportButton = document.querySelector("#exportButton");
const icsButton = document.querySelector("#icsButton");
const shareStatus = document.querySelector("#shareStatus");
const toast = document.querySelector("#toast");

let dbPromise;
let dirty = false;
let loading = true;
let autosaveTimer = 0;
let toastTimer = 0;
let currentKey = localDateKey(new Date());
let tokenClient = null;
let accessToken = "";
let googleReady = false;

init();

async function init() {
  dateButton.textContent = formatDate(new Date());
  dateButton.addEventListener("click", openGoogleCalendarDay);
  memoText.addEventListener("input", onTextInput);
  memoText.addEventListener("scroll", updateScrollThumb);
  saveButton.addEventListener("click", () => saveMemo({ force: true, toast: true }));
  voiceButton.addEventListener("click", startSpeechInput);
  calendarButton.addEventListener("click", openGoogleCalendarDraft);
  settingsButton.addEventListener("click", () => settingsDialog.showModal());
  clientIdInput.value = localStorage.getItem(GOOGLE_CLIENT_ID_KEY) || "";
  calendarIdInput.value = localStorage.getItem(GOOGLE_CALENDAR_ID_KEY) || "primary";
  clientIdInput.addEventListener("change", saveGoogleSettings);
  calendarIdInput.addEventListener("change", saveGoogleSettings);
  googleSignInButton.addEventListener("click", connectGoogle);
  googleSignOutButton.addEventListener("click", disconnectGoogle);
  exportButton.addEventListener("click", exportJson);
  icsButton.addEventListener("click", downloadIcs);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveMemo({ force: false });
  });
  window.addEventListener("beforeunload", () => saveMemo({ force: false }));
  window.addEventListener("resize", updateScrollThumb);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {
      setStatus("オフライン準備に失敗しました");
    });
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "share-text") appendSharedText(event.data.text);
    });
  }

  await loadMemo();
  await consumeSharedTextFromUrl();
  await prepareGoogle();
  memoText.focus({ preventScroll: true });
}

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "date" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

async function getEntry(date) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).get(date);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function putEntry(entry) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readwrite").objectStore(STORE).put(entry);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function allEntries() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function loadMemo() {
  setStatus("読み込み中...");
  loading = true;
  try {
    const entry = await getEntry(currentKey);
    memoText.value = entry?.text || "";
    dirty = false;
    setStatus(entry ? "読み込み済み" : "新規メモ");
    if (accessToken) await loadGoogleMemo();
  } catch {
    setStatus("読み込みに失敗しました");
  } finally {
    loading = false;
    updateScrollThumb();
  }
}

function onTextInput() {
  if (loading) return;
  dirty = true;
  setStatus("未保存");
  clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => saveMemo({ force: false }), AUTOSAVE_MS);
  updateScrollThumb();
}

async function saveMemo({ force = false, toast: showToast = false } = {}) {
  if (!dirty && !force) return;
  clearTimeout(autosaveTimer);
  setStatus("保存中...");
  const now = new Date().toISOString();
  try {
    await putEntry({
      date: currentKey,
      title: EVENT_TITLE,
      text: memoText.value,
      updatedAt: now,
    });
    if (accessToken) await saveGoogleMemo();
    dirty = false;
    setStatus(accessToken ? "Google Calendar に保存済み" : "保存済み");
    if (showToast) showToastMessage("保存しました");
  } catch {
    dirty = true;
    setStatus("保存に失敗しました");
  }
}

function appendSharedText(text) {
  const value = String(text || "").trim();
  if (!value) return;
  const separator = memoText.value.length === 0 ? "" : memoText.value.endsWith("\n") ? "\n" : "\n\n";
  memoText.value += separator + value;
  memoText.selectionStart = memoText.selectionEnd = memoText.value.length;
  shareStatus.textContent = "追加済み";
  dirty = true;
  setStatus("共有テキストを追加しました");
  clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => saveMemo({ force: false }), AUTOSAVE_MS);
  updateScrollThumb();
}

async function consumeSharedTextFromUrl() {
  const params = new URLSearchParams(location.search);
  const text = params.get("text") || params.get("title") || "";
  if (!text) return;
  appendSharedText(text);
  history.replaceState(null, "", location.pathname);
}

function startSpeechInput() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    showToastMessage("音声入力を利用できません");
    return;
  }

  const recognition = new Recognition();
  recognition.lang = navigator.language || "ja-JP";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onstart = () => setStatus("音声入力中...");
  recognition.onerror = () => setStatus(dirty ? "編集中" : "保存済み");
  recognition.onresult = (event) => {
    const text = event.results?.[0]?.[0]?.transcript || "";
    insertAtCursor(text);
  };
  recognition.onend = () => {
    if (dirty) setStatus("未保存");
  };
  recognition.start();
}

async function prepareGoogle() {
  updateGoogleStatus();
  if (!clientIdInput.value.trim()) return;
  try {
    await waitForGoogleIdentity();
    createTokenClient();
    googleReady = true;
    updateGoogleStatus();
  } catch {
    googleStatus.textContent = "初期化失敗";
  }
}

function saveGoogleSettings() {
  localStorage.setItem(GOOGLE_CLIENT_ID_KEY, clientIdInput.value.trim());
  localStorage.setItem(GOOGLE_CALENDAR_ID_KEY, calendarIdInput.value.trim() || "primary");
  tokenClient = null;
  accessToken = "";
  googleReady = false;
  prepareGoogle();
}

async function connectGoogle() {
  saveGoogleSettings();
  if (!clientIdInput.value.trim()) {
    showToastMessage("OAuth クライアント ID を入力してください");
    return;
  }
  await prepareGoogle();
  if (!tokenClient) return;
  tokenClient.callback = async (response) => {
    if (response.error) {
      googleStatus.textContent = "接続失敗";
      return;
    }
    accessToken = response.access_token;
    googleStatus.textContent = "接続中";
    showToastMessage("Google に接続しました");
    await loadGoogleMemo();
  };
  tokenClient.requestAccessToken({ prompt: "consent" });
}

function disconnectGoogle() {
  if (accessToken && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(accessToken);
  }
  accessToken = "";
  updateGoogleStatus();
  showToastMessage("Google 接続を解除しました");
}

function createTokenClient() {
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientIdInput.value.trim(),
    scope: GOOGLE_SCOPE,
    callback: () => {},
  });
}

function waitForGoogleIdentity() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (window.google?.accounts?.oauth2) {
        window.clearInterval(timer);
        resolve();
      } else if (Date.now() - started > 8000) {
        window.clearInterval(timer);
        reject(new Error("Google Identity Services was not loaded"));
      }
    }, 80);
  });
}

async function loadGoogleMemo() {
  try {
    setStatus("Google Calendar 読み込み中...");
    const event = await findGoogleMemoEvent();
    if (!event) {
      setStatus(memoText.value ? "ローカル読み込み済み" : "新規メモ");
      return;
    }
    if (!dirty) {
      memoText.value = event.description || "";
      await putEntry({
        date: currentKey,
        title: EVENT_TITLE,
        text: memoText.value,
        googleEventId: event.id,
        updatedAt: new Date().toISOString(),
      });
      setStatus("Google Calendar 読み込み済み");
      updateScrollThumb();
    }
  } catch {
    setStatus("Google Calendar を読み込めませんでした");
  }
}

async function saveGoogleMemo() {
  const existing = await findGoogleMemoEvent();
  const event = {
    summary: EVENT_TITLE,
    description: memoText.value,
    start: { date: currentKey },
    end: { date: nextDateKey(currentKey) },
  };
  if (existing) {
    await googleRequest(`/calendars/${encodeURIComponent(calendarId())}/events/${encodeURIComponent(existing.id)}`, {
      method: "PATCH",
      body: event,
    });
  } else {
    await googleRequest(`/calendars/${encodeURIComponent(calendarId())}/events`, {
      method: "POST",
      body: event,
    });
  }
}

async function findGoogleMemoEvent() {
  const params = new URLSearchParams({
    timeMin: `${currentKey}T00:00:00${timeZoneOffset()}`,
    timeMax: `${nextDateKey(currentKey)}T00:00:00${timeZoneOffset()}`,
    singleEvents: "true",
    showDeleted: "false",
    orderBy: "startTime",
    q: EVENT_TITLE,
  });
  const result = await googleRequest(`/calendars/${encodeURIComponent(calendarId())}/events?${params}`);
  return (result.items || []).find((event) => {
    const startDate = event.start?.date || event.start?.dateTime?.slice(0, 10);
    return event.summary === EVENT_TITLE && startDate === currentKey;
  });
}

async function googleRequest(path, options = {}) {
  const response = await fetch(`${GOOGLE_DISCOVERY_BASE}${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) {
    if (response.status === 401) accessToken = "";
    throw new Error(`Google Calendar API error: ${response.status}`);
  }
  return response.status === 204 ? null : response.json();
}

function calendarId() {
  return calendarIdInput.value.trim() || "primary";
}

function updateGoogleStatus() {
  if (accessToken) {
    googleStatus.textContent = "接続中";
  } else if (clientIdInput.value.trim() && googleReady) {
    googleStatus.textContent = "接続可能";
  } else if (clientIdInput.value.trim()) {
    googleStatus.textContent = "未接続";
  } else {
    googleStatus.textContent = "未設定";
  }
}

function insertAtCursor(text) {
  if (!text.trim()) return;
  const start = memoText.selectionStart;
  const end = memoText.selectionEnd;
  memoText.setRangeText(text, start, end, "end");
  memoText.dispatchEvent(new Event("input", { bubbles: true }));
}

function openGoogleCalendarDay() {
  const date = compactDate(currentKey);
  window.open(`https://calendar.google.com/calendar/u/0/r/day/${date}`, "_blank", "noopener");
}

function openGoogleCalendarDraft() {
  const date = compactDate(currentKey);
  const next = compactDate(nextDateKey(currentKey));
  const url = new URL("https://calendar.google.com/calendar/render");
  url.searchParams.set("action", "TEMPLATE");
  url.searchParams.set("text", EVENT_TITLE);
  url.searchParams.set("details", memoText.value);
  url.searchParams.set("dates", `${date}/${next}`);
  window.open(url.toString(), "_blank", "noopener");
}

async function exportJson() {
  await saveMemo({ force: dirty });
  const entries = await allEntries();
  downloadBlob(
    new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), entries }, null, 2)], {
      type: "application/json",
    }),
    `instant-daily-memo-${currentKey}.json`
  );
}

async function downloadIcs() {
  await saveMemo({ force: dirty });
  const endKey = nextDateKey(currentKey);
  const body = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Instant Daily Memo//PWA//JA",
    "BEGIN:VEVENT",
    `UID:${currentKey}@instant-daily-memo.local`,
    `DTSTAMP:${icsTimestamp(new Date())}`,
    `DTSTART;VALUE=DATE:${compactDate(currentKey)}`,
    `DTEND;VALUE=DATE:${compactDate(endKey)}`,
    `SUMMARY:${escapeIcs(EVENT_TITLE)}`,
    `DESCRIPTION:${escapeIcs(memoText.value)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  downloadBlob(new Blob([body], { type: "text/calendar" }), `memo-${currentKey}.ics`);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function updateScrollThumb() {
  const visible = memoText.clientHeight;
  const total = memoText.scrollHeight;
  const track = Math.max(0, visible - 36);
  if (total <= visible || track === 0) {
    scrollThumb.style.height = `${Math.max(36, visible)}px`;
    scrollThumb.style.transform = "translateY(0)";
    return;
  }
  const thumbHeight = Math.max(36, Math.round((visible / total) * visible));
  const maxOffset = Math.max(0, visible - thumbHeight - 36);
  const offset = Math.round((memoText.scrollTop / (total - visible)) * maxOffset);
  scrollThumb.style.height = `${thumbHeight}px`;
  scrollThumb.style.transform = `translateY(${offset}px)`;
}

function setStatus(text) {
  statusText.textContent = text;
}

function showToastMessage(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 1600);
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function nextDateKey(key) {
  const date = new Date(`${key}T00:00:00`);
  date.setDate(date.getDate() + 1);
  return localDateKey(date);
}

function compactDate(key) {
  return key.replaceAll("-", "");
}

function timeZoneOffset() {
  const offset = -new Date().getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
  const minutes = String(Math.abs(offset) % 60).padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}

function formatDate(date) {
  return new Intl.DateTimeFormat(navigator.language || "ja-JP", {
    dateStyle: "full",
  }).format(date);
}

function icsTimestamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeIcs(value) {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll("\r\n", "\\n")
    .replaceAll("\n", "\\n");
}
