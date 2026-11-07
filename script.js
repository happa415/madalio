const APP_VERSION = "1.4.5.6";
const STORAGE_KEY = "simple-date-records-v1";

const textInput = document.querySelector("#record-text");
const saveButton = document.querySelector("#save-button");
const cancelEditButton = document.querySelector("#cancel-edit-button");
const exportJsonButton = document.querySelector("#export-json");
const importButton = document.querySelector("#import-button");
const importFileInput = document.querySelector("#import-file");
const recordsList = document.querySelector("#records-list");
const recordTemplate = document.querySelector("#record-template");
const emptyMessage = document.querySelector("#empty-message");
const recordCount = document.querySelector("#record-count");
const statusMessage = document.querySelector("#status-message");

let storageLoadFailed = false;
let records = loadRecords();
let editingRecordId = null;

renderRecords();

saveButton.addEventListener("click", saveRecord);
cancelEditButton.addEventListener("click", cancelEdit);
exportJsonButton.addEventListener("click", exportAsJson);
importButton.addEventListener("click", () => importFileInput.click());
importFileInput.addEventListener("change", importRecords);

function getToday() {
  const today = new Date();
  return new Date(
    today.getTime() - today.getTimezoneOffset() * 60 * 1000
  )
    .toISOString()
    .slice(0, 10);
}

function loadRecords() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === null) return [];
    const loaded = JSON.parse(saved);
    // 旧形式の欠落だけをメモリ上で補完する。起動時には書き戻さない。
    const normalized = Array.isArray(loaded) ? loaded.map((record) => {
      if (record && typeof record === "object" && !Array.isArray(record) &&
          !Object.prototype.hasOwnProperty.call(record, "updatedAt")) {
        return { ...record, updatedAt: null };
      }
      return record;
    }) : loaded;
    validateRecords(normalized);
    return normalized;
  } catch (error) {
    console.error("記録の読み込みに失敗しました。", error);
    storageLoadFailed = true;
    return null;
  }
}

function saveRecords(nextRecords) {
  if (storageLoadFailed) return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextRecords));
  } catch (error) {
    console.error("記録の保存に失敗しました。", error);
    showStatus("保存に失敗しました。メモは変更されていません。入力内容を残しています。", true);
    return false;
  }
  records = nextRecords;
  return true;
}

function saveRecord() {
  if (storageLoadFailed) return;
  const text = textInput.value.trim();

  if (!text) {
    showStatus("内容を入力してください。", true);
    textInput.focus();
    return;
  }

  if (editingRecordId) {
    const record = records.find((item) => item.id === editingRecordId);
    if (!record) {
      cancelEdit();
      showStatus("編集する記録が見つかりませんでした。", true);
      return;
    }
    const updated = { ...record, text, updatedAt: new Date().toISOString() };
    const nextRecords = records.map((item) => item.id === editingRecordId ? updated : item);
    if (!saveRecords(nextRecords)) return;
    renderRecords();
    finishEdit();
    showStatus("更新しました。");
    return;
  }

  const nextRecords = [createRecord(getToday(), text), ...records];
  if (!saveRecords(nextRecords)) return;
  renderRecords();

  textInput.value = "";
  textInput.focus();
  showStatus("保存しました。");
}

function createRecord(date, text) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    date,
    text,
    createdAt: new Date().toISOString(),
    updatedAt: null,
  };
}

function renderRecords() {
  recordsList.innerHTML = "";
  if (storageLoadFailed) {
    textInput.disabled = true;
    [saveButton, cancelEditButton, importButton, importFileInput, exportJsonButton]
      .forEach((control) => { control.disabled = true; });
    emptyMessage.hidden = true;
    recordCount.textContent = "読み込み失敗";
    showStatus("保存データを読み込めません。データ保護のため操作を停止しています。データは変更していません。ページを再読み込みしてください。", true, 0);
    return;
  }

  getSortedRecords().forEach((record) => {
    const fragment = recordTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".record-card");
    const dateElement = fragment.querySelector(".record-date");
    const textElement = fragment.querySelector(".record-text");
    const copyButton = fragment.querySelector(".copy-button");
    const editButton = fragment.querySelector(".edit-button");
    const deleteButton = fragment.querySelector(".delete-button");

    dateElement.innerHTML = `
      <small>
        作成: ${formatDateTime(record.createdAt)}<br>
        編集: ${formatDateTime(record.updatedAt)}
      </small>
`;

dateElement.dateTime = record.date;
textElement.textContent = record.text;

    copyButton.addEventListener("click", () => copyRecordText(record, copyButton));

    editButton.addEventListener("click", () => startEdit(record.id));

    deleteButton.addEventListener("click", () => {
      if (storageLoadFailed) return;
      const confirmed = window.confirm(
        `${formatDate(record.date)} の記録を削除しますか？`
      );

      if (!confirmed) return;

      const nextRecords = records.filter((item) => item.id !== record.id);
      if (!saveRecords(nextRecords)) return;
      if (editingRecordId === record.id) finishEdit();
      renderRecords();
      showStatus("削除しました。");
    });

    card.dataset.recordId = record.id;
    recordsList.appendChild(fragment);
  });

  emptyMessage.hidden = records.length > 0;
  recordCount.textContent = `${records.length}件`;
}

function startEdit(recordId) {
  if (storageLoadFailed) return;
  const record = records.find((item) => item.id === recordId);
  if (!record) return;

  editingRecordId = recordId;
  textInput.value = record.text;
  saveButton.textContent = "更新する";
  cancelEditButton.hidden = false;
  document.querySelector(".input-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  textInput.focus();
  showStatus("編集中です。");
}

function cancelEdit() {
  if (storageLoadFailed) return;
  finishEdit();
  showStatus("編集をキャンセルしました。");
}

function finishEdit() {
  editingRecordId = null;
  textInput.value = "";
  saveButton.textContent = "保存する";
  cancelEditButton.hidden = true;
}

function copyRecordText(record, button) {
  const textToCopy = record.text;
  const originalText = button.textContent;
  
  navigator.clipboard.writeText(textToCopy).then(() => {
    button.textContent = "完了";
    button.disabled = true;
    
    setTimeout(() => {
      button.textContent = originalText;
      button.disabled = false;
    }, 800);
    
    showStatus("コピーしました。", false, 800);
  }).catch((error) => {
    console.error("コピーに失敗しました。", error);
    showStatus("コピーに失敗しました。", true);
  });
}

function formatDate(dateString) {
  const [year, month, day] = dateString.split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function formatDateTime(dateString) {
  if (!dateString) return "―";

  return new Date(dateString).toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function showStatus(message, isError = false, duration = 4000) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("error", isError);

  window.clearTimeout(showStatus.timer);
  if (duration === 0) return;
  showStatus.timer = window.setTimeout(() => {
    statusMessage.textContent = "";
    statusMessage.classList.remove("error");
  }, duration);
}

function exportAsJson() {
  if (storageLoadFailed) return;
  const backup = { app: "Madalio", formatVersion: 1, records };

  downloadFile(
    `madalio-backup-${getFileDate()}.json`,
    JSON.stringify(backup, null, 2),
    "application/json;charset=utf-8"
  );

  showStatus("JSONバックアップを作成しました。");
}

async function importRecords(event) {
  if (storageLoadFailed) return;
  const file = event.target.files?.[0];
  event.target.value = "";

  if (!file) return;

  try {
    if (file.name.split(".").pop()?.toLowerCase() !== "json") {
      throw new Error("JSONファイルを選んでください。");
    }

    const content = await file.text();
    const imported = parseJsonBackup(content);
    const merged = mergeBackupRecords(records, imported);
    const message = `追加${merged.added}件・更新${merged.updated}件・変更なし${merged.unchanged}件`;
    if (merged.added === 0 && merged.updated === 0) {
      showStatus(message);
      return;
    }

    // 非同期のファイル読み込み完了後、確認直前の入力を判定する。
    const inputText = textInput.value;
    const inputRecordId = editingRecordId;
    const currentRecords = records;
    const editingRecord = records.find((record) => record.id === inputRecordId);
    const hasUnsavedInput = inputRecordId !== null
      ? !editingRecord || inputText !== editingRecord.text
      : inputText.length > 0;
    const confirmed = window.confirm(hasUnsavedInput
      ? "JSONバックアップを読み込みますか？\nバックアップのメモを追加・更新します。\n保存していない入力途中の文章は消去されます。"
      : "JSONバックアップを読み込みますか？\nバックアップのメモを追加・更新します。");
    if (!confirmed) return;
    // confirm後は保存までawaitしない。確認中に状態が変わった場合も破棄しない。
    if (textInput.value !== inputText || editingRecordId !== inputRecordId || records !== currentRecords) {
      showStatus("入力またはメモが変更されたため、読み込みを中止しました。もう一度お試しください。", true);
      return;
    }

    if (!saveRecords(merged.records)) return;
    if (textInput.value === inputText && editingRecordId === inputRecordId) finishEdit();
    renderRecords();
    showStatus(message);
  } catch (error) {
    console.error(error);
    showStatus(error.message || "読み込みに失敗しました。", true);
  }
}

function mergeBackupRecords(current, imported) {
  const merged = current.slice();
  const positions = new Map(current.map((record, index) => [record.id, index]));
  let added = 0;
  let updated = 0;
  let unchanged = 0;

  for (const incoming of imported) {
    if (!positions.has(incoming.id)) {
      positions.set(incoming.id, merged.length);
      merged.push(incoming);
      added += 1;
      continue;
    }

    const index = positions.get(incoming.id);
    const existing = merged[index];
    const identical = ["id", "date", "text", "createdAt", "updatedAt"]
      .every((field) => existing[field] === incoming[field]);
    const incomingTime = Date.parse(incoming.updatedAt ?? incoming.createdAt);
    const existingTime = Date.parse(existing.updatedAt ?? existing.createdAt);

    if (!identical && incomingTime > existingTime) {
      merged[index] = incoming;
      updated += 1;
    } else {
      unchanged += 1;
    }
  }

  return { records: merged, added, updated, unchanged };
}

function parseJsonBackup(content) {
  let backup;
  try {
    backup = JSON.parse(content.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("JSONの形式が正しくありません。");
  }

  if (!backup || typeof backup !== "object" || Array.isArray(backup) ||
      backup.app !== "Madalio" || backup.formatVersion !== 1 ||
      !Array.isArray(backup.records)) {
    throw new Error("Madalioのバックアップ形式（formatVersion: 1）ではありません。");
  }

  return validateRecords(backup.records);
}

function validateRecords(items) {
  if (!Array.isArray(items)) {
    throw new Error("メモの保存データが配列ではありません。");
  }
  const ids = new Set();
  return items.map((record, index) => {
    if (!record || typeof record !== "object" || Array.isArray(record) ||
        typeof record.id !== "string" || !record.id.trim() ||
        typeof record.date !== "string" || !isValidBackupDate(record.date) ||
        typeof record.text !== "string" || !record.text.trim() ||
        !isValidBackupTimestamp(record.createdAt) ||
        !(record.updatedAt === null || isValidBackupTimestamp(record.updatedAt))) {
      throw new Error(`${index + 1}件目のメモの必須フィールド・型・日付が正しくありません。`);
    }
    if (ids.has(record.id)) {
      throw new Error("メモのIDが重複しています。");
    }
    ids.add(record.id);

    const { id, date, text, createdAt, updatedAt } = record;
    return { id, date, text, createdAt, updatedAt };
  });
}

function isValidBackupDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isValidBackupTimestamp(value) {
  if (typeof value !== "string") return false;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !isValidBackupDate(match[1]) ||
      Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59) return false;
  const zone = match[5];
  if (zone !== "Z" && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59)) return false;
  return Number.isFinite(Date.parse(value));
}

function getSortedRecords() {
  return records.slice().sort((a, b) => {
    if (a.date !== b.date) {
      return b.date.localeCompare(a.date);
    }
    return Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });
}

function getFileDate() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function downloadFile(fileName, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// メモの読み込み・保存とは独立して登録する。失敗しても通常利用を続ける。
async function configureServiceWorker() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  const production = location.origin === "https://happa415.github.io" &&
    location.pathname.startsWith("/madalio/");
  const baseUrl = new URL("./", location.href);
  try {
    if (local && new URL(location.href).searchParams.get("pwa-test") !== "1") {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        const worker = registration.active || registration.waiting || registration.installing;
        if (registration.scope === baseUrl.href && worker &&
            worker.scriptURL === new URL("sw.js", baseUrl).href) {
          await registration.unregister();
        }
      }
      return;
    }
    if (!local && !production) return;
    await navigator.serviceWorker.register("./sw.js", { scope: "./", updateViaCache: "none" });
    // 登録成功はキャッシュ準備完了ではないため、準備完了表示は出さない。
  } catch (error) {
    console.warn("オフライン起動の準備に失敗しました。通常利用は続けられます。", error);
  }
}

configureServiceWorker();
