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
    } catch (err) { console.error("PDF Load Error:", err); }
}

async function renderQuiz() {
    if (!questionDoc || !answerDoc) return;
    const actualIdx = displayOrder[currentIndex];
    const scrollArea = document.getElementById('mainScroll');
    const ansSec = document.getElementById('answerSection');
    const leakBtn = document.getElementById('leakBtn');
    
    scrollArea.scrollTop = 0;
    ansSec.classList.add('hidden-viewport');
    leakBtn.innerText = "Leak Answer";

    // Re-draw both to ensure original proportions are captured
    const qPage = await questionDoc.getPage(actualIdx + 1);
    await drawPage(qPage, 'questionCanvas');
    
    const aPage = await answerDoc.getPage(actualIdx + 1);
    await drawPage(aPage, 'answerCanvas');

    document.getElementById('progress').innerText = `${currentIndex + 1} / ${totalQuizzes}`;
    document.getElementById('starBtn').classList.toggle('active', starredItems.has(actualIdx));
}

async function drawPage(page, canvasId) {
    const canvas = document.getElementById(canvasId);
    const context = canvas.getContext('2d');
    const wrapper = canvas.parentElement;
    
    wrapper.style.height = "auto";
    const containerWidth = wrapper.clientWidth || 600;

    // We use viewBox here to ensure we capture the FULL original page area
    const viewport = page.getViewport({ scale: 1, rotation: page.rotate });
    
    const scale = containerWidth / viewport.width;
    const scaledViewport = page.getViewport({ scale: scale * 2, rotation: page.rotate });

    canvas.width = scaledViewport.width;
    canvas.height = scaledViewport.height;

    // This line forces the wrapper to exactly match the PDF page's height-to-width ratio
    wrapper.style.height = (scaledViewport.height / 2) + "px";

    await page.render({ 
        canvasContext: context, 
        viewport: scaledViewport 
    }).promise;
}

function toggleAnswer() {
    const sec = document.getElementById('answerSection');
    const btn = document.getElementById('leakBtn');
    const scrollArea = document.getElementById('mainScroll');
    const isHidden = sec.classList.toggle('hidden-viewport');
    
    if (!isHidden) {
        btn.innerText = "Hide Answer";
        setTimeout(() => {
            scrollArea.scrollTo({ top: scrollArea.scrollHeight, behavior: 'smooth' });
        }, 100);
    } else {
        btn.innerText = "Leak Answer";
    }
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
    const table = document.getElementById('gridTable');
    table.innerHTML = ""; let row;
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