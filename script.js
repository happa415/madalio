const STORAGE_KEY = "simple-date-records-v1";

const dateInput = document.querySelector("#record-date");
const textInput = document.querySelector("#record-text");
const saveButton = document.querySelector("#save-button");
const exportTxtButton = document.querySelector("#export-txt");
const exportCsvButton = document.querySelector("#export-csv");
const recordsList = document.querySelector("#records-list");
const recordTemplate = document.querySelector("#record-template");
const emptyMessage = document.querySelector("#empty-message");
const recordCount = document.querySelector("#record-count");
const statusMessage = document.querySelector("#status-message");

let records = loadRecords();

setToday();
renderRecords();

saveButton.addEventListener("click", saveRecord);
exportTxtButton.addEventListener("click", exportAsTxt);
exportCsvButton.addEventListener("click", exportAsCsv);

function setToday() {
  const today = new Date();
  const localDate = new Date(
    today.getTime() - today.getTimezoneOffset() * 60 * 1000
  )
    .toISOString()
    .slice(0, 10);

  dateInput.value = localDate;
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
  const date = dateInput.value;
  const text = textInput.value.trim();

  if (!date) {
    showStatus("日付を選んでください。", true);
    return;
  }

  if (!text) {
    showStatus("内容を入力してください。", true);
    textInput.focus();
    return;
  }

  const record = {
    id: crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    date,
    text,
    createdAt: new Date().toISOString(),
  };

  records.unshift(record);
  saveRecords();
  renderRecords();

  textInput.value = "";
  textInput.focus();
  showStatus("保存しました。");
}

function renderRecords() {
  recordsList.innerHTML = "";

  records
    .slice()
    .sort((a, b) => {
      if (a.date !== b.date) {
        return b.date.localeCompare(a.date);
      }
      return b.createdAt.localeCompare(a.createdAt);
    })
    .forEach((record) => {
      const fragment = recordTemplate.content.cloneNode(true);
      const card = fragment.querySelector(".record-card");
      const dateElement = fragment.querySelector(".record-date");
      const textElement = fragment.querySelector(".record-text");
      const deleteButton = fragment.querySelector(".delete-button");

      dateElement.textContent = formatDate(record.date);
      dateElement.dateTime = record.date;
      textElement.textContent = record.text;

      deleteButton.addEventListener("click", () => {
        const confirmed = window.confirm(
          `${formatDate(record.date)} の記録を削除しますか？`
        );

        if (!confirmed) return;

        records = records.filter((item) => item.id !== record.id);
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

function formatDate(dateString) {
  const [year, month, day] = dateString.split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function showStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("error", isError);

  window.clearTimeout(showStatus.timer);
  showStatus.timer = window.setTimeout(() => {
    statusMessage.textContent = "";
    statusMessage.classList.remove("error");
  }, 3000);
}

function exportAsTxt() {
  if (!records.length) {
    showStatus("書き出す記録がありません。", true);
    return;
  }

  const content = getSortedRecords()
    .map((record) => `${record.date}\n${record.text}`)
    .join("\n\n--------------------\n\n");

  downloadFile(
    `記録帳_${getFileDate()}.txt`,
    content,
    "text/plain;charset=utf-8"
  );

  showStatus("TXTファイルを作成しました。");
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

  // ExcelやNumbersで日本語が文字化けしにくいようBOMを付けます。
  downloadFile(
    `記録帳_${getFileDate()}.csv`,
    `\uFEFF${csv}`,
    "text/csv;charset=utf-8"
  );

  showStatus("CSVファイルを作成しました。");
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
  return new Date().toISOString().slice(0, 10);
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
