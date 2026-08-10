const STORAGE_KEY = "simple-date-records-v1";

const textInput = document.querySelector("#record-text");
const saveButton = document.querySelector("#save-button");
const cancelEditButton = document.querySelector("#cancel-edit-button");
const exportCsvButton = document.querySelector("#export-csv");
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
exportCsvButton.addEventListener("click", exportAsCsv);
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

function exportAsCsv() {
  if (!records.length) {
    showStatus("書き出す記録がありません。", true);
    return;
  }

  const rows = [
    ["日付", "内容"],
    ...getSortedRecords().map((record) => [record.date, record.text]),
  ];

  const csv = rows
    .map((row) => row.map(escapeCsvValue).join(","))
    .join("\r\n");

  downloadFile(
    `madalio_${getFileDate()}.csv`,
    `\uFEFF${csv}`,
    "text/csv;charset=utf-8"
  );

  showStatus("CSVファイルを作成しました。");
}

async function importRecords(event) {
  const file = event.target.files?.[0];
  event.target.value = "";

  if (!file) return;

  try {
    const content = await file.text();
    const extension = file.name.split(".").pop()?.toLowerCase();

    if (extension !== "csv") {
      throw new Error("CSVファイルを選んでください。");
    }

    const imported = parseCsvRecords(content);

    if (!imported.length) {
      throw new Error("読み込める記録が見つかりませんでした。");
    }

    const existingKeys = new Set(
      records.map((record) => makeDuplicateKey(record.date, record.text))
    );

    const newRecords = imported
      .filter((record) => {
        const key = makeDuplicateKey(record.date, record.text);

        if (existingKeys.has(key)) return false;

        existingKeys.add(key);
        return true;
      })
      .map((record) => createRecord(record.date, record.text));

    if (!newRecords.length) {
      showStatus("すべて登録済みの記録でした。");
      return;
    }

    const confirmed = window.confirm(
      `${newRecords.length}件の記録を追加します。\n現在の記録は消えません。`
    );

    if (!confirmed) return;

    records = [...newRecords, ...records];
    saveRecords();
    renderRecords();

    const skipped = imported.length - newRecords.length;
    const skippedText = skipped ? `（重複${skipped}件を除外）` : "";
    showStatus(`${newRecords.length}件を読み込みました。${skippedText}`);
  } catch (error) {
    console.error(error);
    showStatus(error.message || "読み込みに失敗しました。", true);
  }
}

function parseCsvRecords(content) {
  const rows = parseCsv(content.replace(/^\uFEFF/, ""));

  if (!rows.length) return [];

  const firstRow = rows[0].map((cell) => cell.trim());
  const hasHeader =
    firstRow[0] === "日付" ||
    firstRow[0].toLowerCase() === "date";

  const dataRows = hasHeader ? rows.slice(1) : rows;

  return dataRows
    .map((row) => ({
      date: (row[0] || "").trim(),
      text: (row[1] || "").trim(),
    }))
    .filter(isValidImportedRecord);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }

      row.push(value);

      if (row.some((cell) => cell.length > 0)) {
        rows.push(row);
      }

      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  row.push(value);

  if (row.some((cell) => cell.length > 0)) {
    rows.push(row);
  }

  return rows;
}

function isValidImportedRecord(record) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(record.date || "") &&
    Boolean(record.text?.trim())
  );
}

function makeDuplicateKey(date, text) {
  return `${date}\u0000${text.trim()}`;
}

function getSortedRecords() {
  return records.slice().sort((a, b) => {
    if (a.date !== b.date) {
      return b.date.localeCompare(a.date);
    }
    return b.createdAt.localeCompare(a.createdAt);
  });
}

function escapeCsvValue(value) {
  const text = String(value).replace(/"/g, '""');
  return `"${text}"`;
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
