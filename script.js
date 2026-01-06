pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const pdfFiles = { questions: 'quiz.pdf', answers: 'answer.pdf' };
let questionDoc = null, answerDoc = null, currentIndex = 0, totalQuizzes = 0;
let displayOrder = [], starredItems = new Set();

async function loadPDFs() {
    try {
        questionDoc = await pdfjsLib.getDocument(pdfFiles.questions).promise;
        answerDoc = await pdfjsLib.getDocument(pdfFiles.answers).promise;
        totalQuizzes = Math.min(questionDoc.numPages, answerDoc.numPages);
        displayOrder = [...Array(totalQuizzes).keys()];
        renderQuiz();
        buildGrid();
    } catch (err) {
        document.getElementById('progress').innerText = "File Load Error";
        console.error(err);
    }
}

async function renderQuiz() {
    if (!questionDoc || !answerDoc) return;
    const actualIdx = displayOrder[currentIndex];
    const pageNum = actualIdx + 1;

    // Reset Answer UI State (Anti-Spoiler)
    const ansSec = document.getElementById('answerSection');
    const leakBtn = document.getElementById('leakBtn');
    ansSec.classList.add('hidden-viewport');
    leakBtn.innerText = "Leak Answer";

    // Draw Question
    const qPage = await questionDoc.getPage(pageNum);
    await drawPage(qPage, 'questionCanvas');
    
    // Draw Answer (Renders in background while hidden)
    const aPage = await answerDoc.getPage(pageNum);
    await drawPage(aPage, 'answerCanvas');

    // Update UI
    document.getElementById('progress').innerText = `${currentIndex + 1} / ${totalQuizzes}`;
    document.getElementById('starBtn').classList.toggle('active', starredItems.has(actualIdx));
}

async function drawPage(page, canvasId) {
    const canvas = document.getElementById(canvasId);
    const context = canvas.getContext('2d');
    const containerWidth = canvas.parentElement.clientWidth || 600;

    const unscaledViewport = page.getViewport({ scale: 1 });
    const scale = containerWidth / unscaledViewport.width;
    const viewport = page.getViewport({ scale: scale * 2 }); // High res

    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.parentElement.style.height = (viewport.height / 2) + "px";

    await page.render({ canvasContext: context, viewport: viewport }).promise;
}

function nextQuiz() { if (currentIndex < totalQuizzes - 1) { currentIndex++; renderQuiz(); } }
function prevQuiz() { if (currentIndex > 0) { currentIndex--; renderQuiz(); } }

function toggleAnswer() {
    const sec = document.getElementById('answerSection');
    const btn = document.getElementById('leakBtn');
    const isHidden = sec.classList.toggle('hidden-viewport');
    btn.innerText = isHidden ? "Leak Answer" : "Hide";
}

function toggleStar() {
    const idx = displayOrder[currentIndex];
    starredItems.has(idx) ? starredItems.delete(idx) : starredItems.add(idx);
    document.getElementById('starBtn').classList.toggle('active', starredItems.has(idx));
    buildGrid();
}

function setMode(mode) {
    if (mode === 'random') displayOrder.sort(() => Math.random() - 0.5);
    else displayOrder = [...Array(totalQuizzes).keys()];
    currentIndex = 0;
    renderQuiz();
}

function buildGrid() {
    const table = document.getElementById('gridTable');
    table.innerHTML = "";
    let row;
    for (let i = 0; i < totalQuizzes; i++) {
        if (i % 10 === 0) row = table.insertRow();
        const cell = row.insertCell();
        cell.innerText = i + 1;
        if (starredItems.has(i)) cell.classList.add('starred');
        cell.onclick = () => { currentIndex = displayOrder.indexOf(i); renderQuiz(); toggleGrid(); };
    }
}

function toggleGrid() { document.getElementById('gridOverlay').classList.toggle('hidden'); }

window.addEventListener('resize', renderQuiz);
loadPDFs();