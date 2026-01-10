pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// const pdfFiles = { questions: 'quiz.pdf', answers: 'answer.pdf' };
// GET PARAMETERS FROM URL
const urlParams = new URLSearchParams(window.location.search);
const qFile = urlParams.get('q') || 'default_quiz.pdf'; // Fallback if no file clicked
const aFile = urlParams.get('a') || 'default_ans.pdf';
const Subject = urlParams.get('s') ;

const pdfFiles = { questions: `AC_${Subject}/${Subject}_${qFile}.pdf`, answers: `AC_${Subject}/${Subject}_${aFile}.pdf` };
let questionDoc = null, answerDoc = null, currentIndex = 0, totalQuizzes = 0;
let displayOrder = [], starredItems = new Set();

document.title=`ExamPOG ${Subject} ${qFile}`;


// DRAWING VARIABLES
let currentTool = 'none'; 
let penColor = '#000000'; // Default black
let penSize = 3;
let eraserSize = 20;
let eraserMode = 'precision';
let isDrawing = false;
let currentStroke = [];
let pageStrokes = { q: [], a: [] }; 

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
    
    // Reset Data for new page
    pageStrokes = { q: [], a: [] }; 
    const actualIdx = displayOrder[currentIndex];
    
    // UI Reset
    document.getElementById('mainScroll').scrollTop = 0;
    document.getElementById('answerSection').classList.add('hidden-viewport');
    document.getElementById('leakBtn').innerText = "Leak Answer";

    // Draw Content
    const qPage = await questionDoc.getPage(actualIdx + 1);
    await drawPage(qPage, 'questionCanvas', 'qDraw');
    
    const aPage = await answerDoc.getPage(actualIdx + 1);
    await drawPage(aPage, 'answerCanvas', 'aDraw');
    
    document.getElementById('progress').innerText = `${currentIndex + 1} / ${totalQuizzes}`;
    document.getElementById('starBtn').classList.toggle('active', starredItems.has(actualIdx));
    
    // Safety: Reset tool to view mode
    setTool('none');
}

async function drawPage(page, pdfCanvasId, drawCanvasId) {
    const canvas = document.getElementById(pdfCanvasId);
    const dCanvas = document.getElementById(drawCanvasId);
    const context = canvas.getContext('2d');
    const wrapper = canvas.parentElement;

    // Use fixed geometry logic
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

// --- VECTOR DRAWING ENGINE ---

function setupCanvasListeners(canvasId, type) {
    const canvas = document.getElementById(canvasId);
    
    const start = (e) => {
        if (currentTool === 'none') return;
        if (e.cancelable) e.preventDefault();
        isDrawing = true;
        const p = getPos(canvas, e);
        
        if (currentTool === 'pen') {
            // New stroke object
            currentStroke = { points: [p], color: penColor, size: penSize, tool: 'pen' };
            pageStrokes[type].push(currentStroke);
        } else if (currentTool === 'eraser' && eraserMode === 'stroke') {
            checkStrokeDelete(type, p);
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
                    currentStroke = { points: [p], size: eraserSize, tool: 'eraser' };
                    pageStrokes[type].push(currentStroke);
                } else {
                    currentStroke.points.push(p);
                }
                repaint(type);
            } else {
                checkStrokeDelete(type, p);
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
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: (cx - rect.left) * scaleX, y: (cy - rect.top) * scaleY };
}

function repaint(type) {
    const canvas = document.getElementById(type === 'q' ? 'qDraw' : 'aDraw');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    pageStrokes[type].forEach(s => {
        ctx.beginPath();
        if (s.points.length > 0) {
            ctx.moveTo(s.points[0].x, s.points[0].y);
            for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
        }
        
        if (s.tool === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.lineWidth = s.size;
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = s.color;
            ctx.lineWidth = s.size;
        }
        ctx.stroke();
    });
    ctx.globalCompositeOperation = 'source-over';
}

function checkStrokeDelete(type, p) {
    const threshold = eraserSize / 2;
    pageStrokes[type] = pageStrokes[type].filter(s => {
        if (s.tool === 'eraser') return true;
        for (let pt of s.points) {
            const dist = Math.sqrt((pt.x - p.x)**2 + (pt.y - p.y)**2);
            if (dist < threshold) return false;
        }
        return true;
    });
}

// --- TOOLS & SETTINGS ---

function setTool(tool) {
    if (currentTool === tool && tool !== 'none') {
        currentTool = 'none';
    } else {
        currentTool = tool;
    }
    
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

// NEW: Handled by the color picker input
function setColor(val) {
    penColor = val;
}

function setEraserMode(m) {
    eraserMode = m;
    document.getElementById('modePrecision').classList.toggle('active', m === 'precision');
    document.getElementById('modeStroke').classList.toggle('active', m === 'stroke');
}

function clearAllStrokes() {
    if(confirm("Clear All?")) {
        pageStrokes = { q: [], a: [] };
        repaint('q'); repaint('a');
    }
}

// Listeners
setupCanvasListeners('qDraw', 'q');
setupCanvasListeners('aDraw', 'a');

// Navigation
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
    const table = document.getElementById('gridTable'); table.innerHTML = ""; let row;
    for (let i = 0; i < totalQuizzes; i++) {
        if (i % 10 === 0) row = table.insertRow(); // 10 items per row looks better
        const cell = row.insertCell(); cell.innerText = i + 1;
        if (starredItems.has(i)) cell.classList.add('starred');
        cell.onclick = () => { currentIndex = displayOrder.indexOf(i); renderQuiz(); toggleGrid(); };
    }
}
function toggleGrid() { document.getElementById('gridOverlay').classList.toggle('hidden'); }
window.addEventListener('resize', renderQuiz);
loadPDFs();

// receive value from 