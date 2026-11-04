// App State
const state = {
  activePersonId: 1,
  people: {
    1: { name: "Person 1", color: "rgba(0, 229, 255, 0.5)", total: 0 },
    2: { name: "Person 2", color: "rgba(255, 0, 128, 0.5)", total: 0 },
    3: { name: "Person 3", color: "rgba(255, 235, 59, 0.5)", total: 0 },
    4: { name: "Person 4", color: "rgba(156, 39, 176, 0.5)", total: 0 },
    5: { name: "Person 5", color: "rgba(76, 175, 80, 0.5)", total: 0 }
  },
  detectedItems: [], 
  strokes: []        
};

// DOM Elements
const receiptInput = document.getElementById('receipt-input');
const receiptImg = document.getElementById('receipt-img');
const canvas = document.getElementById('highlight-canvas');
const ctx = canvas.getContext('2d');
const studioSection = document.getElementById('studio-section');
const ocrStatus = document.getElementById('ocr-status');

// Handle File Upload
receiptInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    receiptImg.src = event.target.result;
    receiptImg.onload = () => {
      setupCanvas();
      runOCR(file);
    };
  };
  reader.readAsDataURL(file);
});

function setupCanvas() {
  canvas.width = receiptImg.clientWidth;
  canvas.height = receiptImg.clientHeight;
  studioSection.classList.remove('hidden');
}

// Run OCR safely with error handling
async function runOCR(imageFile) {
  ocrStatus.classList.remove('hidden');
  ocrStatus.innerText = 'Scanning receipt text and totals...';

  try {
    if (typeof Tesseract === 'undefined') {
      throw new Error('Tesseract library not loaded');
    }
    const worker = await Tesseract.createWorker('eng');
    const ret = await worker.recognize(imageFile);
    await worker.terminate();

    parseOCRData(ret.data);
    ocrStatus.classList.add('hidden');
  } catch (err) {
    console.warn('OCR processing notice:', err);
    ocrStatus.innerText = 'Freeform highlight mode ready.';
    setTimeout(() => ocrStatus.classList.add('hidden'), 3000);
  }
}

// Extract prices & bounding boxes
function parseOCRData(data) {
  state.detectedItems = [];
  const lines = data.lines || [];

  lines.forEach(line => {
    const text = line.text.trim();
    const priceMatch = text.match(/\$?(\d+\.\d{2})/);
    if (priceMatch) {
      const price = parseFloat(priceMatch[1]);
      state.detectedItems.push({
        text: text,
        price: price,
        bbox: line.bbox,
        assignedPerson: null
      });
    }
  });
}

// Canvas Drawing & Pointer Events
let isDrawing = false;
let currentStroke = [];

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  isDrawing = true;
  currentStroke = [];
  addPoint(e);
});

canvas.addEventListener('pointermove', (e) => {
  if (!isDrawing) return;
  e.preventDefault();
  addPoint(e);
  redrawCanvas();
  drawStroke(currentStroke, state.people[state.activePersonId].color);
});

canvas.addEventListener('pointerup', (e) => {
  if (!isDrawing) return;
  e.preventDefault();
  isDrawing = false;
  state.strokes.push({
    personId: state.activePersonId,
    points: currentStroke
  });
  checkStrokeIntersections(currentStroke, state.activePersonId);
  redrawCanvas();
});

function addPoint(e) {
  const rect = canvas.getBoundingClientRect();
  currentStroke.push({
    x: e.clientX - rect.left,
    y: e.clientY - rect.top
  });
}

function drawStroke(points, color) {
  if (points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 18;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'multiply';

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
  ctx.restore();
}

function redrawCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  state.strokes.forEach(s => {
    drawStroke(s.points, state.people[s.personId].color);
  });
}

function checkStrokeIntersections(stroke, personId) {
  const scaleX = receiptImg.naturalWidth / canvas.width;
  const scaleY = receiptImg.naturalHeight / canvas.height;

  stroke.forEach(pt => {
    const imgX = pt.x * scaleX;
    const imgY = pt.y * scaleY;

    state.detectedItems.forEach(item => {
      const b = item.bbox;
      if (imgX >= b.x0 && imgX <= b.x1 && imgY >= b.y0 && imgY <= b.y1) {
        item.assignedPerson = personId;
      }
    });
  });

  recalculateTotals();
}

function recalculateTotals() {
  Object.keys(state.people).forEach(id => {
    state.people[id].total = 0;
  });

  state.detectedItems.forEach(item => {
    if (item.assignedPerson) {
      state.people[item.assignedPerson].total += item.price;
    }
  });

  updateSummaryUI();
}

function updateSummaryUI() {
  const totalsList = document.getElementById('totals-list');
  totalsList.innerHTML = '';
  Object.keys(state.people).forEach(id => {
    const p = state.people[id];
    totalsList.innerHTML += `<li>${p.name}: <strong>$${p.total.toFixed(2)}</strong></li>`;
  });
}

// Switch Active Person
document.getElementById('person-selector').addEventListener('click', (e) => {
  const btn = e.target.closest('.person-btn');
  if (!btn) return;

  document.querySelectorAll('.person-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  state.activePersonId = parseInt(btn.dataset.id);
});

// Clear Highlights
document.getElementById('clear-btn').addEventListener('click', () => {
  state.strokes = [];
  state.detectedItems.forEach(i => i.assignedPerson = null);
  redrawCanvas();
  recalculateTotals();
});

// Export PDF & Share
document.getElementById('export-pdf-btn').addEventListener('click', async () => {
  if (!window.jspdf) {
    alert("PDF library is still loading. Please try again in a moment.");
    return;
  }
  
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF();

  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = receiptImg.naturalWidth;
  exportCanvas.height = receiptImg.naturalHeight;
  const eCtx = exportCanvas.getContext('2d');

  eCtx.drawImage(receiptImg, 0, 0);
  eCtx.drawImage(canvas, 0, 0, exportCanvas.width, exportCanvas.height);

  const imgData = exportCanvas.toDataURL('image/jpeg', 0.85);
  pdf.addImage(imgData, 'JPEG', 10, 10, 190, (exportCanvas.height * 190) / exportCanvas.width);

  pdf.addPage();
  pdf.setFontSize(16);
  pdf.text("AnchorWise - Receipt Split Summary", 14, 20);

  let yPos = 35;
  Object.keys(state.people).forEach(id => {
    const p = state.people[id];
    pdf.setFontSize(12);
    pdf.text(`${p.name}: $${p.total.toFixed(2)}`, 14, yPos);
    yPos += 10;
  });

  const pdfBlob = pdf.output('blob');

  if (navigator.canShare && navigator.canShare({ files: [new File([pdfBlob], 'receipt-split.pdf', { type: 'application/pdf' })] })) {
    const file = new File([pdfBlob], 'receipt-split.pdf', { type: 'application/pdf' });
    await navigator.share({
      files: [file],
      title: 'AnchorWise Receipt Split',
      text: 'Here is your highlighted receipt breakdown!'
    });
  } else {
    pdf.save('receipt-split.pdf');
  }
});
