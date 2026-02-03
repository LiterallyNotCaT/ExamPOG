pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

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
        renderQuiz(); 
        buildGrid();
    } catch (err) { console.error("PDF Error:", err); }
}

async function renderQuiz() {
    if (!questionDoc || !answerDoc) return;
    const actualIdx = displayOrder[currentIndex];
    
    // UI Reset
    document.getElementById('mainScroll').scrollTop = 0;
    document.getElementById('answerSection').classList.add('hidden-viewport');
    document.getElementById('leakBtn').innerText = "Leak Answer";

    // 1. LOAD STROKES
    if (!allStrokes[actualIdx]) {
        allStrokes[actualIdx] = { q: [], a: [] };
    }
    pageStrokes = allStrokes[actualIdx];

    // 2. DRAW PAGES
    const qPage = await questionDoc.getPage(actualIdx + 1);
    await drawPage(qPage, 'questionCanvas', 'qDraw');
    
    const aPage = await answerDoc.getPage(actualIdx + 1);
    await drawPage(aPage, 'answerCanvas', 'aDraw');
    
    // 3. REPAINT
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

    const containerWidth = wrapper.clientWidth || 600;
    const unscaled = page.getViewport({ scale: 1, rotation: page.rotate });
    const scale = containerWidth / unscaled.width;
    const viewport = page.getViewport({ scale: scale * 2, rotation: page.rotate });

    canvas.width = viewport.width;
    canvas.height = viewport.height;
    dCanvas.width = viewport.width;
    dCanvas.height = viewport.height;
    
    wrapper.style.height = (viewport.height / 2) + "px";

    await page.render({ canvasContext: context, viewport: viewport }).promise;
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
            currentStroke = { 
                points: [p], color: penColor, 
                size: penSize / canvas.width, tool: 'pen' 
            };
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
                    currentStroke = { 
                        points: [p], size: eraserSize / canvas.width, tool: 'eraser' 
                    };
                    pageStrokes[type].push(currentStroke);
                } else {
                    currentStroke.points.push(p);
                }
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
    return { 
        x: (cx - rect.left) / rect.width, 
        y: (cy - rect.top) / rect.height 
    };
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
            for (let i = 1; i < s.points.length; i++) {
                ctx.lineTo(s.points[i].x * w, s.points[i].y * h);
            }
        }
        
        const renderSize = Math.max(1, s.size * w);

        if (s.tool === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.lineWidth = renderSize;
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = s.color;
            ctx.lineWidth = renderSize;
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

// --- TOOLS ---
function setTool(tool) {
    if (currentTool === tool && tool !== 'none') { currentTool = 'none'; } 
    else { currentTool = tool; }
    
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

// --- MENU & EXPORT ---
function toggleExportMenu() {
    document.getElementById('exportMenu').classList.toggle('hidden');
}

document.addEventListener('click', function(event) {
    const menu = document.getElementById('exportMenu');
    const btn = document.querySelector('.btn-menu');
    // Only close if we are not clicking inside the settings area (selects need clicks)
    if (!menu.contains(event.target) && !btn.contains(event.target)) {
        menu.classList.add('hidden');
    }
});

function updateProgressBar(percent, text) {
    const overlay = document.getElementById('progressOverlay');
    const bar = document.getElementById('progressBar');
    const txt = document.getElementById('progressText');
    
    if (percent === null) {
        overlay.classList.add('hidden'); // Ensure CSS hides it
    } else {
        overlay.classList.remove('hidden');
        overlay.style.display = 'flex'; // Enable Flexbox
        bar.style.width = percent + '%';
        txt.innerText = text || Math.round(percent) + '%';
    }
}

// Renders page to Image Object (optimized for size)
async function renderPageToImage(pageIndex, type = 'q') {
    const pdfDoc = type === 'q' ? questionDoc : answerDoc;
    const page = await pdfDoc.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale: 1.5 }); 
    
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
        const w = canvas.width;
        const h = canvas.height;
        strokes.forEach(s => {
            ctx.beginPath();
            if (s.points.length > 0) {
                ctx.moveTo(s.points[0].x * w, s.points[0].y * h);
                for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x * w, s.points[i].y * h);
            }
            const renderSize = Math.max(1, s.size * w);
            if (s.tool === 'eraser') {
                ctx.globalCompositeOperation = 'source-over';
                ctx.strokeStyle = '#ffffff'; 
                ctx.lineWidth = renderSize;
            } else {
                ctx.globalCompositeOperation = 'source-over';
                ctx.strokeStyle = s.color;
                ctx.lineWidth = renderSize;
            }
            ctx.stroke();
        });
    }

    return { 
        dataUrl: canvas.toDataURL('image/jpeg', 0.6), 
        width: viewport.width, 
        height: viewport.height 
    };
}

async function saveCurrentPage(format) {
    toggleExportMenu();
    updateProgressBar(0, "Preparing...");
    const actualIdx = displayOrder[currentIndex];
    
    setTimeout(async () => {
        const imgData = await renderPageToImage(actualIdx, 'q');
        if (format === 'png') {
            const link = document.createElement('a');
            link.download = `Page_${actualIdx + 1}.jpg`;
            link.href = imgData.dataUrl;
            link.click();
        } else {
            const { jsPDF } = window.jspdf;
            const orientation = imgData.width > imgData.height ? 'l' : 'p';
            const pdf = new jsPDF(orientation, 'px', [imgData.width, imgData.height]);
            pdf.addImage(imgData.dataUrl, 'JPEG', 0, 0, imgData.width, imgData.height);
            pdf.save(`Page_${actualIdx + 1}.pdf`);
        }
        updateProgressBar(null);
    }, 100);
}

// --- NEW SAVE ALL FUNCTION WITH SETTINGS ---
async function saveAllPages() {
    toggleExportMenu();
    
    // Get Settings
    const format = document.getElementById('exportFormat').value; // "1" or "4"
    const filter = document.getElementById('exportFilter').value; // "all" or "starred"
    
    updateProgressBar(0, "Identifying pages...");

    setTimeout(async () => {
        try {
            const { jsPDF } = window.jspdf;
            let pdfDoc = null;
            
            // 1. FILTER: Identify which pages to export
            let pagesToExport = [];
            for(let i=0; i<totalQuizzes; i++) {
                if (filter === 'starred') {
                    const isStarred = starredItems.has(i);
                    const hasNotes = allStrokes[i] && (allStrokes[i].q.length > 0 || allStrokes[i].a.length > 0);
                    if (isStarred || hasNotes) {
                        pagesToExport.push(i);
                    }
                } else {
                    pagesToExport.push(i);
                }
            }

            if (pagesToExport.length === 0) {
                alert("No pages match your filter settings.");
                updateProgressBar(null);
                return;
            }

            // 2. EXPORT LOOP
            // We use the dimensions of the FIRST page to determine PDF layout
            // For 4-in-1, we assume all pages have roughly similar ratio for best result
            
            let pageWidth = 0, pageHeight = 0;
            let counter = 0; // Counts images drawn on current PDF page

            for (let k = 0; k < pagesToExport.length; k++) {
                const idx = pagesToExport[k];
                const percent = Math.round((k / pagesToExport.length) * 100);
                updateProgressBar(percent, `Processing Page ${k + 1}/${pagesToExport.length}`);

                const imgData = await renderPageToImage(idx, 'q');
                
                // Initialize PDF on first item
                if (pdfDoc === null) {
                    pageWidth = imgData.width;
                    pageHeight = imgData.height;
                    const orientation = pageWidth > pageHeight ? 'l' : 'p';
                    
                    if (format === '4') {
                        // For 4-in-1, PDF page size stays same, but we draw images smaller.
                        // OR we make PDF page 2x bigger. Let's make PDF page 2x bigger to keep quality.
                        pdfDoc = new jsPDF(orientation, 'px', [pageWidth * 2, pageHeight * 2]);
                    } else {
                        pdfDoc = new jsPDF(orientation, 'px', [pageWidth, pageHeight]);
                    }
                }

                if (format === '1') {
                    // Standard 1 per page
                    if (k > 0) {
                        pdfDoc.addPage([pageWidth, pageHeight], pageWidth > pageHeight ? 'l' : 'p');
                    }
                    pdfDoc.addImage(imgData.dataUrl, 'JPEG', 0, 0, pageWidth, pageHeight);
                } 
                else if (format === '4') {
                    // 4 per page Logic
                    // 0 | 1
                    // -----
                    // 2 | 3
                    
                    if (counter === 4) {
                        pdfDoc.addPage([pageWidth * 2, pageHeight * 2], pageWidth > pageHeight ? 'l' : 'p');
                        counter = 0;
                    }

                    const x = (counter % 2) * pageWidth;
                    const y = Math.floor(counter / 2) * pageHeight;

                    // Draw image at full resolution into the quadrant
                    pdfDoc.addImage(imgData.dataUrl, 'JPEG', x, y, pageWidth, pageHeight);
                    
                    // Draw a light border around quadrant
                    pdfDoc.setDrawColor(200, 200, 200);
                    pdfDoc.rect(x, y, pageWidth, pageHeight);
                    
                    counter++;
                }

                await new Promise(r => setTimeout(r, 10));
            }
            
            updateProgressBar(100, "Saving File...");
            pdfDoc.save('Exported_Quiz.pdf');
            
        } catch (e) {
            console.error(e);
            alert("Error: " + e.message);
        } finally {
            updateProgressBar(null);
        }
    }, 100);
}

// Listeners
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