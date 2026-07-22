(function () {
    'use strict';

    const video = document.getElementById('video');
    const overlay = document.getElementById('overlay');
    const ctx = overlay.getContext('2d');
    const statusBar = document.getElementById('status-bar');
    const statusText = document.getElementById('status-text');
    const qrResult = document.getElementById('qr-result');
    const qrValue = document.getElementById('qr-value');

    let detector = null;
    let animFrameId = null;
    let lastDetectedValue = '';
    let hideTimeout = null;

    // Inizializza BarcodeDetector
    async function initDetector() {
        if ('BarcodeDetector' in window) {
            const formats = await BarcodeDetector.getSupportedFormats();
            if (formats.includes('qr_code')) {
                detector = new BarcodeDetector({ formats: ['qr_code'] });
                return true;
            }
        }
        return false;
    }

    // Avvia la fotocamera posteriore
    async function startCamera() {
        const constraints = {
            video: {
                facingMode: { ideal: 'environment' },
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: false
        };

        try {
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            video.srcObject = stream;
            await video.play();
            return true;
        } catch (err) {
            console.error('Errore accesso fotocamera:', err);
            setStatus('Errore: impossibile accedere alla fotocamera', 'error');
            return false;
        }
    }

    // Aggiorna lo stato nella barra
    function setStatus(text, type) {
        statusText.textContent = text;
        statusBar.className = type || '';
    }

    // Mostra il risultato QR
    function showQrResult(value) {
        qrValue.textContent = value;
        qrResult.classList.remove('hidden');
        lastDetectedValue = value;

        // Nascondi dopo 3 secondi se non viene più rilevato
        clearTimeout(hideTimeout);
        hideTimeout = setTimeout(function () {
            if (lastDetectedValue === value) {
                qrResult.classList.add('hidden');
                lastDetectedValue = '';
            }
        }, 3000);
    }

    // Disegna i corner points rilevati sul canvas overlay
    function drawCornerPoints(cornerPoints) {
        ctx.clearRect(0, 0, overlay.width, overlay.height);

        if (!cornerPoints || cornerPoints.length < 4) return;

        // Calcola il fattore di scala tra video reale e canvas
        const scaleX = overlay.width / video.videoWidth;
        const scaleY = overlay.height / video.videoHeight;

        ctx.strokeStyle = '#6366f1';
        ctx.lineWidth = 3;
        ctx.fillStyle = 'rgba(99, 102, 241, 0.15)';

        // Disegna il poligono
        ctx.beginPath();
        ctx.moveTo(cornerPoints[0].x * scaleX, cornerPoints[0].y * scaleY);
        for (let i = 1; i < cornerPoints.length; i++) {
            ctx.lineTo(cornerPoints[i].x * scaleX, cornerPoints[i].y * scaleY);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Disegna i punti agli angoli
        ctx.fillStyle = '#6ee7b7';
        for (const point of cornerPoints) {
            ctx.beginPath();
            ctx.arc(point.x * scaleX, point.y * scaleY, 6, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // Loop di rilevamento
    async function detectLoop() {
        if (!detector || video.readyState < 2) {
            animFrameId = requestAnimationFrame(detectLoop);
            return;
        }

        // Sincronizza dimensioni canvas con video
        if (overlay.width !== video.videoWidth || overlay.height !== video.videoHeight) {
            overlay.width = video.videoWidth;
            overlay.height = video.videoHeight;
        }

        try {
            const barcodes = await detector.detect(video);

            if (barcodes.length > 0) {
                const qr = barcodes[0]; // Per ora gestiamo il primo rilevato
                showQrResult(qr.rawValue);
                drawCornerPoints(qr.cornerPoints);
                setStatus('QR rilevato', 'scanning');
            } else {
                ctx.clearRect(0, 0, overlay.width, overlay.height);
                setStatus('Inquadra un QR code...', 'scanning');
            }
        } catch (err) {
            // detect() può fallire se il video non è pronto
            console.warn('Errore detection:', err);
        }

        animFrameId = requestAnimationFrame(detectLoop);
    }

    // Inizializzazione
    async function init() {
        setStatus('Avvio fotocamera...', '');

        const hasDetector = await initDetector();
        if (!hasDetector) {
            setStatus('BarcodeDetector non supportato su questo browser', 'error');
            return;
        }

        const cameraOk = await startCamera();
        if (!cameraOk) return;

        setStatus('Inquadra un QR code...', 'scanning');
        detectLoop();
    }

    // Gestisci resize per mantenere overlay sincronizzato
    window.addEventListener('resize', function () {
        if (video.videoWidth && video.videoHeight) {
            overlay.width = video.videoWidth;
            overlay.height = video.videoHeight;
        }
    });

    // Avvia
    init();
})();
