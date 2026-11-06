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
    return saved ? JSON.parse(saved) : [];
  } catch (error) {
    console.error("記録の読み込みに失敗しました。", error);
    return [];
  }
}

function saveRecords() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function saveRecord() {
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
    record.text = text;
    record.updatedAt = new Date().toISOString();
    saveRecords();
    renderRecords();
    finishEdit();
    showStatus("更新しました。");
    return;
  }

  records.unshift(createRecord(getToday(), text));
  saveRecords();
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
      const confirmed = window.confirm(
        `${formatDate(record.date)} の記録を削除しますか？`
      );

      if (!confirmed) return;

      records = records.filter((item) => item.id !== record.id);
      if (editingRecordId === record.id) finishEdit();
      saveRecords();
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
  showStatus.timer = window.setTimeout(() => {
    statusMessage.textContent = "";
    statusMessage.classList.remove("error");
  }, duration);
}

function exportAsJson() {
  const backup = { app: "Madalio", formatVersion: 1, records };

  downloadFile(
    `madalio-backup-${getFileDate()}.json`,
    JSON.stringify(backup, null, 2),
    "application/json;charset=utf-8"
  );

  showStatus("JSONバックアップを作成しました。");
}

async function importRecords(event) {
  const file = event.target.files?.[0];
  event.target.value = "";

  if (!file) return;

  try {
    if (file.name.split(".").pop()?.toLowerCase() !== "json") {
      throw new Error("JSONファイルを選んでください。");
    }

    const content = await file.text();
    const imported = parseJsonBackup(content);
    const confirmed = window.confirm(
      "現在のメモをすべて置き換えます。よろしいですか？"
    );
    if (!confirmed) return;

    // 保存に成功するまで、現在のメモと編集中の内容には触れない。
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(imported));
    } catch (error) {
      console.error("バックアップの保存に失敗しました。", error);
      showStatus("保存に失敗しました。現在のメモは変更されていません。", true);
      return;
    }

    records = imported;
    finishEdit();
    renderRecords();
    showStatus(`${records.length}件の記録を復元しました。`);
  } catch (error) {
    console.error(error);
    showStatus(error.message || "読み込みに失敗しました。", true);
  }
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

  const ids = new Set();
  return backup.records.map((record, index) => {
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
  // 現行アプリが保存するUTCのISO日時を受け入れ、元の文字列を保持する。
  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function getSortedRecords() {
  return records.slice().sort((a, b) => {
    if (a.date !== b.date) {
      return b.date.localeCompare(a.date);
    }
    return b.createdAt.localeCompare(a.createdAt);
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
