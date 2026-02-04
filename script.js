pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ** PASTE YOUR GOOGLE WEB APP URL HERE **
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzNO7tr0g6Bbs9c1SGxYlf1zHq2qqMXPd4v3M3ALadDV9E5mfuuC_NTsP0-ve9nRk6BXQ/exec"; 

// URL Parameters
const urlParams = new URLSearchParams(window.location.search);
const qFile = urlParams.get('q') || 'default_quiz.pdf'; 
const aFile = urlParams.get('a') || 'default_ans.pdf';
const Subject = urlParams.get('s') || 'Subject';

const pdfFiles = { questions: `AC_${Subject}/${Subject}_${qFile}.pdf`, answers: `AC_${Subject}/${Subject}_${aFile}.pdf` };
let questionDoc = null, answerDoc = null, currentIndex = 0, totalQuizzes = 0;
let displayOrder = [], starredItems = new Set();

document.title = `ExamPOG ${Subject} ${qFile}`;

// DRAWING VARIABLES
let currentTool = 'none'; 
let penColor = '#000000'; 
let penSize = 3;
let eraserSize = 20;
let eraserMode = 'precision';
let isDrawing = false;
let currentStroke = [];
let pageStrokes = { q: [], a: [] }; 
let allStrokes = {}; 

async function loadPDFs() {
    try {
        questionDoc = await pdfjsLib.getDocument(pdfFiles.questions).promise;
        answerDoc = await pdfjsLib.getDocument(pdfFiles.answers).promise;
        totalQuizzes = Math.min(questionDoc.numPages, answerDoc.numPages);
        displayOrder = [...Array(totalQuizzes).keys()];
        
        document.getElementById('rangeTo').value = totalQuizzes;
        
        renderQuiz(); 
        buildGrid();
    } catch (err) { console.error("PDF Error:", err); }
}

async function renderQuiz() {
    if (!questionDoc || !answerDoc) return;
    const actualIdx = displayOrder[currentIndex];
    
    document.getElementById('mainScroll').scrollTop = 0;
    document.getElementById('answerSection').classList.add('hidden-viewport');
    document.getElementById('leakBtn').innerText = "Leak Answer";

    if (!allStrokes[actualIdx]) allStrokes[actualIdx] = { q: [], a: [] };
    pageStrokes = allStrokes[actualIdx];

    const qPage = await questionDoc.getPage(actualIdx + 1);
    await drawPage(qPage, 'questionCanvas', 'qDraw');
    
    const aPage = await answerDoc.getPage(actualIdx + 1);
    await drawPage(aPage, 'answerCanvas', 'aDraw');
    
    repaint('q');
    repaint('a');
    
    document.getElementById('progress').innerText = `${currentIndex + 1} / ${totalQuizzes}`;
    document.getElementById('starBtn').classList.toggle('active', starredItems.has(actualIdx));
    setTool('none');
}

async function drawPage(page, pdfCanvasId, drawCanvasId) {
    const canvas = document.getElementById(pdfCanvasId);
    const dCanvas = document.getElementById(drawCanvasId);
    const context = canvas.getContext('2d');
    const wrapper = canvas.parentElement;

    const unscaled = page.getViewport({ scale: 1, rotation: page.rotate });
    const containerWidth = wrapper.clientWidth || 600;
    const scale = containerWidth / unscaled.width;
    const viewport = page.getViewport({ scale: scale * 2, rotation: page.rotate });

    canvas.width = viewport.width;
    canvas.height = viewport.height;
    dCanvas.width = viewport.width;
    dCanvas.height = viewport.height;
    
    await page.render({ canvasContext: context, viewport: viewport }).promise;
}

// --- APPEAL LOGIC ---
function toggleAppeal() {
    document.getElementById('appealModal').classList.toggle('hidden');
    toggleExportMenu(); // Close the menu underneath
}

function openAppeal() {
    const actualIdx = displayOrder[currentIndex] + 1;
    // Set text
    document.getElementById('appealInfo').innerText = 
        `${Subject} | ${qFile} | Page ${actualIdx}`;
    // Clear inputs
    document.getElementById('appealQuizNum').value = "";
    document.getElementById('appealComment').value = "";
    
    // Show modal
    document.getElementById('appealModal').classList.remove('hidden');
    // Hide menu
    document.getElementById('exportMenu').classList.add('hidden');
}

function submitAppeal() {
    const quizNum = document.getElementById('appealQuizNum').value;
    const comment = document.getElementById('appealComment').value;
    const actualIdx = displayOrder[currentIndex] + 1;
    
    if(!comment) { alert("Please write a comment."); return; }

    const btn = document.querySelector('.btn-submit-appeal');
    const oldText = btn.innerText;
    btn.innerText = "Sending...";
    btn.disabled = true;

    // Build URL for GET request (easiest for Apps Script)
    const params = new URLSearchParams();
    params.append('subject', Subject);
    params.append('fileName', qFile);
    params.append('pageNumber', actualIdx);
    params.append('quizNum', quizNum);
    params.append('comments', comment);

    fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST',
        body: params
    })
    .then(response => {
        alert("Appeal sent successfully!");
        document.getElementById('appealModal').classList.add('hidden');
    })
    .catch(err => {
        console.error(err);
        alert("Appeal Sent (No Response Check)"); // Fallback for CORS opaque response
        document.getElementById('appealModal').classList.add('hidden');
    })
    .finally(() => {
        btn.innerText = oldText;
        btn.disabled = false;
    });
}

// --- NORMALIZED DRAWING ENGINE ---
function setupCanvasListeners(canvasId, type) {
    const canvas = document.getElementById(canvasId);
    
    const start = (e) => {
        if (currentTool === 'none') return;
        if (e.cancelable) e.preventDefault();
        isDrawing = true;
        const p = getPos(canvas, e);
        
        if (currentTool === 'pen') {
            currentStroke = { points: [p], color: penColor, size: penSize / canvas.width, tool: 'pen' };
            pageStrokes[type].push(currentStroke);
        } else if (currentTool === 'eraser' && eraserMode === 'stroke') {
            checkStrokeDelete(type, p, canvas.width);
        }
        repaint(type);
    };

    const move = (e) => {
        if (!isDrawing || currentTool === 'none') return;
        if (e.cancelable) e.preventDefault();
        const p = getPos(canvas, e);
        
        if (currentTool === 'pen') {
            currentStroke.points.push(p);
            repaint(type);
        } else if (currentTool === 'eraser') {
            if (eraserMode === 'precision') {
                if(!currentStroke.points) {
                    currentStroke = { points: [p], size: eraserSize / canvas.width, tool: 'eraser' };
                    pageStrokes[type].push(currentStroke);
                } else { currentStroke.points.push(p); }
                repaint(type);
            } else {
                checkStrokeDelete(type, p, canvas.width);
                repaint(type);
            }
        }
    };
    const end = () => { isDrawing = false; currentStroke = {}; };
    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    canvas.addEventListener('mouseup', end);
    canvas.addEventListener('touchstart', start, {passive: false});
    canvas.addEventListener('touchmove', move, {passive: false});
    canvas.addEventListener('touchend', end);
}

function getPos(canvas, e) {
    const rect = canvas.getBoundingClientRect();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: (cx - rect.left) / rect.width, y: (cy - rect.top) / rect.height };
}

function repaint(type) {
    const canvas = document.getElementById(type === 'q' ? 'qDraw' : 'aDraw');
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    if (!pageStrokes[type]) return;
    pageStrokes[type].forEach(s => {
        ctx.beginPath();
        if (s.points.length > 0) {
            ctx.moveTo(s.points[0].x * w, s.points[0].y * h);
            for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x * w, s.points[i].y * h);
        }
        const renderSize = Math.max(1, s.size * w);
        if (s.tool === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out'; ctx.lineWidth = renderSize;
        } else {
            ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = s.color; ctx.lineWidth = renderSize;
        }
        ctx.stroke();
    });
    ctx.globalCompositeOperation = 'source-over';
}

function checkStrokeDelete(type, p, canvasWidth) {
    const threshold = (eraserSize / canvasWidth) / 2; 
    pageStrokes[type] = pageStrokes[type].filter(s => {
        if (s.tool === 'eraser') return true;
        for (let pt of s.points) {
            const dist = Math.sqrt((pt.x - p.x)**2 + (pt.y - p.y)**2);
            if (dist < threshold) return false;
        }
        return true;
    });
}

function setTool(tool) {
    if (currentTool === tool && tool !== 'none') { currentTool = 'none'; } else { currentTool = tool; }
    document.getElementById('penBtn').classList.toggle('active', currentTool === 'pen');
    document.getElementById('eraserBtn').classList.toggle('active', currentTool === 'eraser');
    const mode = (currentTool === 'none') ? 'none' : 'auto';
    document.getElementById('qDraw').style.pointerEvents = mode;
    document.getElementById('aDraw').style.pointerEvents = mode;
    document.querySelectorAll('.settings-popup').forEach(el => el.classList.add('hidden'));
}
function toggleSettings(id) {
    const el = document.getElementById(id);
    const isHidden = el.classList.contains('hidden');
    document.querySelectorAll('.settings-popup').forEach(x => x.classList.add('hidden'));
    if (isHidden) el.classList.remove('hidden');
}
function updateSettings(key, val) {
    if (key === 'penSize') penSize = parseInt(val);
    if (key === 'eraserSize') eraserSize = parseInt(val);
}
function setColor(val) { penColor = val; }
function setEraserMode(m) {
    eraserMode = m;
    document.getElementById('modePrecision').classList.toggle('active', m === 'precision');
    document.getElementById('modeStroke').classList.toggle('active', m === 'stroke');
}
function clearAllStrokes() {
    if(confirm("Clear All?")) {
        pageStrokes.q = []; pageStrokes.a = [];
        repaint('q'); repaint('a');
    }
}

function toggleExportMenu() { document.getElementById('exportMenu').classList.toggle('hidden'); }
document.addEventListener('click', function(event) {
    const menu = document.getElementById('exportMenu');
    const btn = document.querySelector('.btn-menu');
    const isSetting = event.target.closest('.settings-popup') || event.target.closest('.tool-settings-trigger');
    const isModal = event.target.closest('#appealModal') && !event.target.classList.contains('overlay');
    if (!menu.contains(event.target) && !btn.contains(event.target) && !isSetting && !isModal && !event.target.closest('.btn-appeal')) {
        menu.classList.add('hidden');
        document.querySelectorAll('.settings-popup').forEach(x => x.classList.add('hidden'));
    }
});

function updateProgressBar(percent, text) {
    const overlay = document.getElementById('progressOverlay');
    const bar = document.getElementById('progressBar');
    const txt = document.getElementById('progressText');
    if (percent === null) { overlay.classList.add('hidden'); } 
    else {
        overlay.classList.remove('hidden'); overlay.style.display = 'flex'; 
        bar.style.width = percent + '%'; txt.innerText = text || Math.round(percent) + '%';
    }
}

async function renderPageToImage(pageIndex, type) {
    const pdfDoc = type === 'q' ? questionDoc : answerDoc;
    const page = await pdfDoc.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale: 2.0 }); 
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: viewport }).promise;

    const strokes = allStrokes[pageIndex] ? allStrokes[pageIndex][type] : [];
    if (strokes.length > 0) {
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        const w = canvas.width; const h = canvas.height;
        strokes.forEach(s => {
            ctx.beginPath();
            if (s.points.length > 0) {
                ctx.moveTo(s.points[0].x * w, s.points[0].y * h);
                for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x * w, s.points[i].y * h);
            }
            const renderSize = Math.max(1, s.size * w);
            if (s.tool === 'eraser') {
                ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = renderSize;
            } else {
                ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = s.color; ctx.lineWidth = renderSize;
            }
            ctx.stroke();
        });
    }
    return { dataUrl: canvas.toDataURL('image/jpeg', 0.8), width: viewport.width, height: viewport.height };
}

async function saveCurrentPage(format) {
    toggleExportMenu();
    updateProgressBar(0, "Preparing...");
    const actualIdx = displayOrder[currentIndex];
    const source = document.getElementById('exportSource').value;
    setTimeout(async () => {
        try {
            const processSingle = async (type) => { return await renderPageToImage(actualIdx, type); };
            const sourcesToProcess = source === 'both' ? ['q', 'a'] : [source];

            if (format === 'png') {
                for (const sType of sourcesToProcess) {
                    const imgData = await processSingle(sType);
                    const link = document.createElement('a');
                    const suffix = sType === 'q' ? 'Question' : 'Answer';
                    link.download = `Page_${actualIdx + 1}_${suffix}.jpg`;
                    link.href = imgData.dataUrl;
                    link.click();
                    if(sourcesToProcess.length > 1) await new Promise(r => setTimeout(r, 500)); 
                }
            } else {
                const { jsPDF } = window.jspdf;
                const page = await questionDoc.getPage(actualIdx + 1);
                const orig = page.getViewport({scale: 1});
                const orientation = orig.width > orig.height ? 'l' : 'p';
                const pdfDoc = new jsPDF(orientation, 'px', [orig.width, orig.height]);

                for (let i = 0; i < sourcesToProcess.length; i++) {
                    const sType = sourcesToProcess[i];
                    if (i > 0) pdfDoc.addPage([orig.width, orig.height], orientation);
                    const imgData = await processSingle(sType);
                    pdfDoc.addImage(imgData.dataUrl, 'JPEG', 0, 0, orig.width, orig.height);
                }
                pdfDoc.save(`Page_${actualIdx + 1}.pdf`);
            }
        } catch(e) { console.error(e); }
        updateProgressBar(null);
    }, 100);
}

async function saveAllPages() {
    toggleExportMenu();
    const format = document.getElementById('exportFormat').value; 
    const filter = document.getElementById('exportFilter').value; 
    const source = document.getElementById('exportSource').value; 
    const rFrom = parseInt(document.getElementById('rangeFrom').value) || 1;
    let rTo = parseInt(document.getElementById('rangeTo').value) || totalQuizzes;
    
    if (rTo > totalQuizzes) rTo = totalQuizzes;
    if (rFrom < 1) rFrom = 1;
    if (rFrom > rTo) { alert("Invalid Range"); return; }

    updateProgressBar(0, "Identifying pages...");

    setTimeout(async () => {
        try {
            const { jsPDF } = window.jspdf;
            let pdfDoc = null;
            let pageWidth = 0, pageHeight = 0;
            let pagesToExport = [];
            for(let i = rFrom - 1; i < rTo; i++) {
                if (filter === 'starred') {
                    const isStarred = starredItems.has(i);
                    const hasNotes = allStrokes[i] && (allStrokes[i].q.length > 0 || allStrokes[i].a.length > 0);
                    if (isStarred || hasNotes) pagesToExport.push(i);
                } else { pagesToExport.push(i); }
            }

            if (pagesToExport.length === 0) { alert("No pages match your settings."); updateProgressBar(null); return; }

            const firstPageObj = await questionDoc.getPage(pagesToExport[0] + 1);
            const orig = firstPageObj.getViewport({ scale: 1 });
            pageWidth = orig.width; pageHeight = orig.height;
            const orientation = pageWidth > pageHeight ? 'l' : 'p';
            pdfDoc = new jsPDF(orientation, 'px', [pageWidth, pageHeight]);

            let queue = [];
            if (source !== 'both') {
                pagesToExport.forEach(idx => queue.push({ idx, type: source }));
            } else {
                if (format === '1') {
                    pagesToExport.forEach(idx => { queue.push({ idx, type: 'q' }); queue.push({ idx, type: 'a' }); });
                } else {
                    for (let i = 0; i < pagesToExport.length; i += 4) {
                        const chunk = pagesToExport.slice(i, i + 4);
                        chunk.forEach(idx => queue.push({ idx, type: 'q' }));
                        chunk.forEach(idx => queue.push({ idx, type: 'a' }));
                    }
                }
            }

            let counter = 0; 
            for (let k = 0; k < queue.length; k++) {
                const item = queue[k];
                updateProgressBar(Math.round((k / queue.length) * 100), `Page ${item.idx + 1} (${item.type.toUpperCase()})`);
                const imgData = await renderPageToImage(item.idx, item.type);

                if (format === '1') {
                    if (k > 0) pdfDoc.addPage([pageWidth, pageHeight], orientation);
                    pdfDoc.addImage(imgData.dataUrl, 'JPEG', 0, 0, pageWidth, pageHeight);
                } 
                else if (format === '4') {
                    if (counter === 4) { pdfDoc.addPage([pageWidth, pageHeight], orientation); counter = 0; }
                    const subW = pageWidth / 2; const subH = pageHeight / 2;
                    const x = (counter % 2) * subW; const y = Math.floor(counter / 2) * subH;
                    pdfDoc.addImage(imgData.dataUrl, 'JPEG', x, y, subW, subH);
                    pdfDoc.setDrawColor(240, 240, 240); pdfDoc.rect(x, y, subW, subH);
                    counter++;
                    if (source === 'both' && k < queue.length - 1) {
                         if (queue[k].type !== queue[k+1].type && counter > 0 && counter < 4) { counter = 4; }
                    }
                }
                await new Promise(r => setTimeout(r, 5));
            }
            updateProgressBar(100, "Saving File...");
            pdfDoc.save('Customized_Quiz.pdf');
        } catch (e) { console.error(e); alert("Error: " + e.message); } 
        finally { updateProgressBar(null); }
    }, 100);
}

setupCanvasListeners('qDraw', 'q');
setupCanvasListeners('aDraw', 'a');

function toggleAnswer() {
    const sec = document.getElementById('answerSection');
    const isHidden = sec.classList.toggle('hidden-viewport');
    document.getElementById('leakBtn').innerText = isHidden ? "Leak Answer" : "Hide Solution";
    if (!isHidden) setTimeout(() => document.getElementById('mainScroll').scrollTo({ top: document.getElementById('mainScroll').scrollHeight, behavior: 'smooth' }), 100);
}
function nextQuiz() { if (currentIndex < totalQuizzes - 1) { currentIndex++; renderQuiz(); } }
function prevQuiz() { if (currentIndex > 0) { currentIndex--; renderQuiz(); } }
function toggleStar() {
    const idx = displayOrder[currentIndex];
    starredItems.has(idx) ? starredItems.delete(idx) : starredItems.add(idx);
    document.getElementById('starBtn').classList.toggle('active', starredItems.has(idx));
    buildGrid(); 
}
function setMode(mode) { 
    displayOrder = (mode === 'random') ? displayOrder.sort(() => Math.random() - 0.5) : [...Array(totalQuizzes).keys()]; 
    currentIndex = 0; renderQuiz(); 
}
function buildGrid() {
    const count = starredItems.size;
    const txt = document.getElementById('starCountDisplay');
    if(txt) txt.innerText = `There are ${count} starred questions.`;
    const table = document.getElementById('gridTable'); table.innerHTML = ""; let row;
    for (let i = 0; i < totalQuizzes; i++) {
        if (i % 10 === 0) row = table.insertRow(); 
        const cell = row.insertCell(); cell.innerText = i + 1;
        if (starredItems.has(i)) cell.classList.add('starred');
        cell.onclick = () => { currentIndex = displayOrder.indexOf(i); renderQuiz(); toggleGrid(); };
    }
}
function toggleGrid() { document.getElementById('gridOverlay').classList.toggle('hidden'); }
window.addEventListener('resize', renderQuiz);
loadPDFs();