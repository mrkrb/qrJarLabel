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
            img.onload = function () {
                labelImage = img;
                resolve();
            };
            img.onerror = function () {
                console.warn('Impossibile caricare test-label.png');
                resolve();
            };
            img.src = 'assets/test-label.png';
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

        clearTimeout(hideTimeout);
        hideTimeout = setTimeout(function () {
            if (lastDetectedValue === value) {
                qrResult.classList.add('hidden');
                lastDetectedValue = '';
            }
        }, 3000);
    }

    // =========================================================================
    // TRASFORMAZIONE PROSPETTICA VIA SUDDIVISIONE IN TRIANGOLI
    //
    // Canvas 2D supporta solo trasformazioni affini (3 punti → 3 punti).
    // Per ottenere un warp prospettico a 4 punti, suddividiamo l'immagine
    // sorgente in una griglia NxN di celle, e per ciascuna cella calcoliamo
    // le coordinate di destinazione tramite interpolazione bilineare dei
    // 4 corner points. Ogni cella viene poi disegnata come 2 triangoli
    // con trasformazione affine ciascuno.
    // =========================================================================

    var GRID_DIVISIONS = 8; // Più divisioni = più qualità, meno performance

    /**
     * Interpola bilinearmente un punto (u, v) con u,v in [0,1]
     * usando i 4 corner points di destinazione.
     * corners: [topLeft, topRight, bottomRight, bottomLeft]
     */
    function bilinearInterpolate(u, v, corners) {
        var tl = corners[0], tr = corners[1], br = corners[2], bl = corners[3];
        var x = (1 - u) * (1 - v) * tl.x + u * (1 - v) * tr.x +
                u * v * br.x + (1 - u) * v * bl.x;
        var y = (1 - u) * (1 - v) * tl.y + u * (1 - v) * tr.y +
                u * v * br.y + (1 - u) * v * bl.y;
        return { x: x, y: y };
    }

    /**
     * Disegna un triangolo dell'immagine sorgente mappato su un triangolo
     * di destinazione usando una trasformazione affine.
     *
     * src: 3 punti nell'immagine sorgente [{x,y}, {x,y}, {x,y}]
     * dst: 3 punti di destinazione sul canvas [{x,y}, {x,y}, {x,y}]
     * img: HTMLImageElement sorgente
     */
    function drawTriangle(img, src, dst) {
        // Calcola la matrice affine che mappa src → dst
        // | dst0.x |   | a  b  tx | | src0.x |
        // | dst0.y | = | c  d  ty | | src0.y |
        // |   1    |   | 0  0   1 | |   1    |

        var x0 = src[0].x, y0 = src[0].y;
        var x1 = src[1].x, y1 = src[1].y;
        var x2 = src[2].x, y2 = src[2].y;

        var u0 = dst[0].x, v0 = dst[0].y;
        var u1 = dst[1].x, v1 = dst[1].y;
        var u2 = dst[2].x, v2 = dst[2].y;

        // Inversa della matrice sorgente
        var det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
        if (Math.abs(det) < 1e-6) return; // Triangolo degenere

        var iDet = 1.0 / det;

        // Matrice affine: dst = M * src
        var a = ((u1 - u0) * (y2 - y0) - (u2 - u0) * (y1 - y0)) * iDet;
        var b = ((u2 - u0) * (x1 - x0) - (u1 - u0) * (x2 - x0)) * iDet;
        var tx = u0 - a * x0 - b * y0;

        var c = ((v1 - v0) * (y2 - y0) - (v2 - v0) * (y1 - y0)) * iDet;
        var d = ((v2 - v0) * (x1 - x0) - (v1 - v0) * (x2 - x0)) * iDet;
        var ty = v0 - c * x0 - d * y0;

        ctx.save();

        // Clip al triangolo di destinazione
        ctx.beginPath();
        ctx.moveTo(u0, v0);
        ctx.lineTo(u1, v1);
        ctx.lineTo(u2, v2);
        ctx.closePath();
        ctx.clip();

        // Applica la trasformazione affine e disegna l'immagine
        ctx.setTransform(a, c, b, d, tx, ty);
        ctx.drawImage(img, 0, 0);

        ctx.restore();
    }

    /**
     * Disegna l'immagine warpata prospetticamente sui 4 corner points.
     * cornerPoints: ordine orario da BarcodeDetector [TL, TR, BR, BL]
     */
    function drawWarpedImage(img, cornerPoints) {
        if (!img || !cornerPoints || cornerPoints.length < 4) return;

        var imgW = img.naturalWidth || img.width;
        var imgH = img.naturalHeight || img.height;
        var n = GRID_DIVISIONS;

        // Scala i corner points dal sistema di coordinate video al canvas
        var scaleX = overlay.width / video.videoWidth;
        var scaleY = overlay.height / video.videoHeight;

        var corners = [
            { x: cornerPoints[0].x * scaleX, y: cornerPoints[0].y * scaleY },
            { x: cornerPoints[1].x * scaleX, y: cornerPoints[1].y * scaleY },
            { x: cornerPoints[2].x * scaleX, y: cornerPoints[2].y * scaleY },
            { x: cornerPoints[3].x * scaleX, y: cornerPoints[3].y * scaleY }
        ];

        // Per ogni cella della griglia, calcola i 4 punti di destinazione
        // e disegna 2 triangoli
        for (var row = 0; row < n; row++) {
            for (var col = 0; col < n; col++) {
                // Coordinate normalizzate [0,1] dei 4 angoli della cella
                var u0 = col / n,       v0 = row / n;
                var u1 = (col + 1) / n, v1 = row / n;
                var u2 = (col + 1) / n, v2 = (row + 1) / n;
                var u3 = col / n,       v3 = (row + 1) / n;

                // Punti sorgente nell'immagine
                var s0 = { x: u0 * imgW, y: v0 * imgH };
                var s1 = { x: u1 * imgW, y: v1 * imgH };
                var s2 = { x: u2 * imgW, y: v2 * imgH };
                var s3 = { x: u3 * imgW, y: v3 * imgH };

                // Punti destinazione interpolati bilinearmente
                var d0 = bilinearInterpolate(u0, v0, corners);
                var d1 = bilinearInterpolate(u1, v1, corners);
                var d2 = bilinearInterpolate(u2, v2, corners);
                var d3 = bilinearInterpolate(u3, v3, corners);

                // Triangolo 1: TL, TR, BR
                drawTriangle(img, [s0, s1, s2], [d0, d1, d2]);
                // Triangolo 2: TL, BR, BL
                drawTriangle(img, [s0, s2, s3], [d0, d2, d3]);
            }
        }
    }

    /**
     * Disegna l'overlay sul QR code rilevato.
     * Se l'immagine label è disponibile, usa il warp prospettico.
     * Altrimenti, disegna il debug con poligono e corner points.
     */
    function drawOverlay(cornerPoints) {
        ctx.clearRect(0, 0, overlay.width, overlay.height);

        if (!cornerPoints || cornerPoints.length < 4) return;

        if (labelImage) {
            // Warp prospettico dell'immagine
            drawWarpedImage(labelImage, cornerPoints);
        } else {
            // Fallback: debug con poligono
            var points = cornerPoints;
            var scaleX = overlay.width / video.videoWidth;
            var scaleY = overlay.height / video.videoHeight;

            ctx.strokeStyle = '#6366f1';
            ctx.lineWidth = 3;
            ctx.fillStyle = 'rgba(99, 102, 241, 0.15)';

            ctx.beginPath();
            ctx.moveTo(points[0].x * scaleX, points[0].y * scaleY);
            for (var i = 1; i < points.length; i++) {
                ctx.lineTo(points[i].x * scaleX, points[i].y * scaleY);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#6ee7b7';
            for (var j = 0; j < points.length; j++) {
                ctx.beginPath();
                ctx.arc(points[j].x * scaleX, points[j].y * scaleY, 6, 0, Math.PI * 2);
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

        // Sincronizza dimensioni canvas con video
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

        // Carica immagine di test in parallelo
        await loadTestLabel();

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
