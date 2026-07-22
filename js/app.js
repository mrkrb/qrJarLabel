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

    // Immagine di test per l'overlay (hardcoded per milestone 3)
    let labelImage = null;

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

    // Carica l'immagine di test
    function loadTestLabel() {
        return new Promise(function (resolve) {
            var img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = function () {
                labelImage = img;
                console.log('Label caricata:', img.naturalWidth, 'x', img.naturalHeight);
                resolve();
            };
            img.onerror = function (e) {
                console.warn('Errore caricamento label:', e);
                resolve();
            };
            img.src = './assets/test-label.png';
        });
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

    function setStatus(text, type) {
        statusText.textContent = text;
        statusBar.className = type || '';
    }

    function showQrResult(value) {
        qrValue.textContent = value;
        qrResult.classList.remove('hidden');
        lastDetectedValue = value;

        clearTimeout(hideTimeout);
        hideTimeout = setTimeout(function () {
            if (lastDetectedValue === value) {
                qrResult.classList.add('hidden');
                lastDetectedValue = '';
            }
        }, 3000);
    }

    // =========================================================================
    // TRASFORMAZIONE PROSPETTICA
    //
    // Approccio: suddividiamo il quadrilatero sorgente (l'immagine) e il
    // quadrilatero destinazione (i 4 corner points) in una griglia NxN.
    // Per ogni cella, calcoliamo la posizione di destinazione con interpolazione
    // bilineare, poi disegniamo la porzione di immagine usando drawImage con
    // una trasformazione affine (setTransform) e clipping a triangolo.
    // =========================================================================

    var SUBDIVISIONS = 8;

    /**
     * Interpola bilinearmente un punto (u, v) in [0,1]x[0,1]
     * sui 4 corner points di destinazione [TL, TR, BR, BL].
     */
    function bilerp(u, v, c) {
        return {
            x: (1-u)*(1-v)*c[0].x + u*(1-v)*c[1].x + u*v*c[2].x + (1-u)*v*c[3].x,
            y: (1-u)*(1-v)*c[0].y + u*(1-v)*c[1].y + u*v*c[2].y + (1-u)*v*c[3].y
        };
    }

    /**
     * Disegna una porzione triangolare dell'immagine mappata su un triangolo
     * di destinazione. Usa la tecnica standard texture-mapping con Canvas 2D:
     * 
     * 1. Definire il clip path sul triangolo di destinazione
     * 2. Calcolare la matrice affine che mappa i 3 vertici sorgente ai 3 di dest
     * 3. Applicare setTransform e drawImage
     */
    function textureTriangle(img, imgW, imgH, s0, s1, s2, d0, d1, d2) {
        // Matrice sorgente (coordinate nell'immagine)
        var sx0 = s0.x, sy0 = s0.y;
        var sx1 = s1.x, sy1 = s1.y;
        var sx2 = s2.x, sy2 = s2.y;

        // Matrice destinazione (coordinate sul canvas)
        var dx0 = d0.x, dy0 = d0.y;
        var dx1 = d1.x, dy1 = d1.y;
        var dx2 = d2.x, dy2 = d2.y;

        // Risolviamo per la matrice affine M tale che:
        // M * [sx0, sy0, 1]^T = [dx0, dy0]^T
        // M * [sx1, sy1, 1]^T = [dx1, dy1]^T
        // M * [sx2, sy2, 1]^T = [dx2, dy2]^T
        //
        // M = | m11  m12  m13 |
        //     | m21  m22  m23 |

        var denom = (sx0 * (sy1 - sy2) + sx1 * (sy2 - sy0) + sx2 * (sy0 - sy1));
        if (Math.abs(denom) < 0.001) return;

        var invDenom = 1.0 / denom;

        var m11 = (dx0 * (sy1 - sy2) + dx1 * (sy2 - sy0) + dx2 * (sy0 - sy1)) * invDenom;
        var m12 = (dx0 * (sx2 - sx1) + dx1 * (sx0 - sx2) + dx2 * (sx1 - sx0)) * invDenom;
        var m13 = (dx0 * (sx1*sy2 - sx2*sy1) + dx1 * (sx2*sy0 - sx0*sy2) + dx2 * (sx0*sy1 - sx1*sy0)) * invDenom;

        var m21 = (dy0 * (sy1 - sy2) + dy1 * (sy2 - sy0) + dy2 * (sy0 - sy1)) * invDenom;
        var m22 = (dy0 * (sx2 - sx1) + dy1 * (sx0 - sx2) + dy2 * (sx1 - sx0)) * invDenom;
        var m23 = (dy0 * (sx1*sy2 - sx2*sy1) + dy1 * (sx2*sy0 - sx0*sy2) + dy2 * (sx0*sy1 - sx1*sy0)) * invDenom;

        ctx.save();

        // Reset transform per il clip path (deve essere in coordinate canvas)
        ctx.setTransform(1, 0, 0, 1, 0, 0);

        // Clip al triangolo di destinazione
        ctx.beginPath();
        ctx.moveTo(dx0, dy0);
        ctx.lineTo(dx1, dy1);
        ctx.lineTo(dx2, dy2);
        ctx.closePath();
        ctx.clip();

        // setTransform(a, b, c, d, e, f) imposta la matrice:
        // | a  c  e |
        // | b  d  f |
        // | 0  0  1 |
        // Dove (a,b) è la colonna per x, (c,d) per y, (e,f) per traslazione
        ctx.setTransform(m11, m21, m12, m22, m13, m23);

        // Disegna l'immagine intera — il clip limita l'output al triangolo
        ctx.drawImage(img, 0, 0, imgW, imgH, 0, 0, imgW, imgH);

        ctx.restore();
    }

    /**
     * Disegna l'immagine warpata prospetticamente sui 4 corner points.
     */
    function drawWarpedImage(img, cornerPoints) {
        if (!img || !cornerPoints || cornerPoints.length < 4) return;

        var imgW = img.naturalWidth || img.width;
        var imgH = img.naturalHeight || img.height;
        var n = SUBDIVISIONS;

        // Scala i corner points dal sistema video al canvas
        var scaleX = overlay.width / video.videoWidth;
        var scaleY = overlay.height / video.videoHeight;

        var corners = [
            { x: cornerPoints[0].x * scaleX, y: cornerPoints[0].y * scaleY },
            { x: cornerPoints[1].x * scaleX, y: cornerPoints[1].y * scaleY },
            { x: cornerPoints[2].x * scaleX, y: cornerPoints[2].y * scaleY },
            { x: cornerPoints[3].x * scaleX, y: cornerPoints[3].y * scaleY }
        ];

        for (var row = 0; row < n; row++) {
            for (var col = 0; col < n; col++) {
                var u0 = col / n,       v0 = row / n;
                var u1 = (col+1) / n,   v1 = row / n;
                var u2 = (col+1) / n,   v2 = (row+1) / n;
                var u3 = col / n,       v3 = (row+1) / n;

                // Punti sorgente nell'immagine
                var s0 = { x: u0 * imgW, y: v0 * imgH };
                var s1 = { x: u1 * imgW, y: v1 * imgH };
                var s2 = { x: u2 * imgW, y: v2 * imgH };
                var s3 = { x: u3 * imgW, y: v3 * imgH };

                // Punti destinazione (interpolazione bilineare)
                var d0 = bilerp(u0, v0, corners);
                var d1 = bilerp(u1, v1, corners);
                var d2 = bilerp(u2, v2, corners);
                var d3 = bilerp(u3, v3, corners);

                // Ogni cella = 2 triangoli
                textureTriangle(img, imgW, imgH, s0, s1, s2, d0, d1, d2);
                textureTriangle(img, imgW, imgH, s0, s2, s3, d0, d2, d3);
            }
        }
    }

    /**
     * Disegna l'overlay sul QR rilevato.
     */
    function drawOverlay(cornerPoints) {
        ctx.clearRect(0, 0, overlay.width, overlay.height);
        if (!cornerPoints || cornerPoints.length < 4) return;

        if (labelImage) {
            drawWarpedImage(labelImage, cornerPoints);
        } else {
            // Fallback debug: poligono + punti
            var scaleX = overlay.width / video.videoWidth;
            var scaleY = overlay.height / video.videoHeight;

            ctx.strokeStyle = '#6366f1';
            ctx.lineWidth = 3;
            ctx.fillStyle = 'rgba(99, 102, 241, 0.15)';

            ctx.beginPath();
            ctx.moveTo(cornerPoints[0].x * scaleX, cornerPoints[0].y * scaleY);
            for (var i = 1; i < cornerPoints.length; i++) {
                ctx.lineTo(cornerPoints[i].x * scaleX, cornerPoints[i].y * scaleY);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#6ee7b7';
            for (var j = 0; j < cornerPoints.length; j++) {
                ctx.beginPath();
                ctx.arc(cornerPoints[j].x * scaleX, cornerPoints[j].y * scaleY, 6, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    // Loop di rilevamento
    async function detectLoop() {
        if (!detector || video.readyState < 2) {
            animFrameId = requestAnimationFrame(detectLoop);
            return;
        }

        if (overlay.width !== video.videoWidth || overlay.height !== video.videoHeight) {
            overlay.width = video.videoWidth;
            overlay.height = video.videoHeight;
        }

        try {
            const barcodes = await detector.detect(video);

            if (barcodes.length > 0) {
                const qr = barcodes[0];
                showQrResult(qr.rawValue);
                drawOverlay(qr.cornerPoints);
                setStatus('QR rilevato', 'scanning');
            } else {
                ctx.clearRect(0, 0, overlay.width, overlay.height);
                setStatus('Inquadra un QR code...', 'scanning');
            }
        } catch (err) {
            console.warn('Errore detection:', err);
        }

        animFrameId = requestAnimationFrame(detectLoop);
    }

    // Inizializzazione
    async function init() {
        setStatus('Avvio...', '');

        const hasDetector = await initDetector();
        if (!hasDetector) {
            setStatus('BarcodeDetector non supportato su questo browser', 'error');
            return;
        }

        await loadTestLabel();

        const cameraOk = await startCamera();
        if (!cameraOk) return;

        setStatus('Inquadra un QR code...', 'scanning');
        detectLoop();
    }

    window.addEventListener('resize', function () {
        if (video.videoWidth && video.videoHeight) {
            overlay.width = video.videoWidth;
            overlay.height = video.videoHeight;
        }
    });

    init();
})();
