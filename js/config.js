(function () {
    'use strict';

    // Elementi DOM
    var listEl = document.getElementById('associations-list');
    var emptyState = document.getElementById('empty-state');
    var btnAdd = document.getElementById('btn-add');

    // Modale scan
    var modalScan = document.getElementById('modal-scan');
    var scanVideo = document.getElementById('scan-video');
    var scanStatus = document.getElementById('scan-status');
    var scanDetected = document.getElementById('scan-detected');
    var scanDetectedValue = document.getElementById('scan-detected-value');
    var btnScanConfirm = document.getElementById('btn-scan-confirm');
    var btnScanCancel = document.getElementById('btn-scan-cancel');

    // Modale upload
    var modalUpload = document.getElementById('modal-upload');
    var uploadQrId = document.getElementById('upload-qr-id');
    var uploadPreviewContainer = document.getElementById('upload-preview-container');
    var uploadPreview = document.getElementById('upload-preview');
    var uploadFileInput = document.getElementById('upload-file-input');
    var btnChooseImage = document.getElementById('btn-choose-image');
    var uploadActions = document.getElementById('upload-actions');
    var btnUploadSave = document.getElementById('btn-upload-save');
    var btnUploadCancel = document.getElementById('btn-upload-cancel');
    var btnUploadClose = document.getElementById('btn-upload-close');

    // Modale delete
    var modalDelete = document.getElementById('modal-delete');
    var deleteQrIdEl = document.getElementById('delete-qr-id');
    var btnDeleteConfirm = document.getElementById('btn-delete-confirm');
    var btnDeleteCancel = document.getElementById('btn-delete-cancel');

    // Stato
    var scanStream = null;
    var scanDetector = null;
    var scanAnimFrame = null;
    var scannedQrId = null; // QR rilevato durante la scansione (attende conferma)
    var currentQrIdForUpload = null;
    var currentFileForUpload = null;
    var deleteTargetId = null;

    // =========================================================================
    // LISTA ASSOCIAZIONI
    // =========================================================================

    async function loadList() {
        var associations = await JarDB.getAll();
        listEl.innerHTML = '';

        if (associations.length === 0) {
            emptyState.classList.remove('hidden');
            return;
        }

        emptyState.classList.add('hidden');
        associations.sort(function (a, b) {
            return (b.createdAt || 0) - (a.createdAt || 0);
        });

        for (var i = 0; i < associations.length; i++) {
            listEl.appendChild(createListItem(associations[i]));
        }
    }

    function createListItem(assoc) {
        var li = document.createElement('li');
        li.className = 'assoc-item';

        var thumb = document.createElement('img');
        thumb.className = 'assoc-thumb';
        if (assoc.imageBlob) {
            thumb.src = URL.createObjectURL(assoc.imageBlob);
        }
        thumb.alt = assoc.qrId;

        var info = document.createElement('div');
        info.className = 'assoc-info';

        var qrLabel = document.createElement('div');
        qrLabel.className = 'assoc-qr-id';
        qrLabel.textContent = assoc.qrId;

        var dateLabel = document.createElement('div');
        dateLabel.className = 'assoc-date';
        if (assoc.createdAt) {
            var d = new Date(assoc.createdAt);
            dateLabel.textContent = d.toLocaleDateString('it-IT') + ' ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
        }

        info.appendChild(qrLabel);
        info.appendChild(dateLabel);

        var actions = document.createElement('div');
        actions.className = 'assoc-actions';

        var btnAddExtra = document.createElement('button');
        btnAddExtra.className = 'btn-icon btn-add-extra';
        btnAddExtra.innerHTML = '&#128247;'; // 📷
        btnAddExtra.setAttribute('aria-label', 'Aggiungi immagine secondaria');
        btnAddExtra.addEventListener('click', function () {
            openExtraUploadModal(assoc.qrId);
        });

        var btnEdit = document.createElement('button');
        btnEdit.className = 'btn-icon btn-edit';
        btnEdit.innerHTML = '&#9998;';
        btnEdit.setAttribute('aria-label', 'Modifica immagine principale');
        btnEdit.addEventListener('click', function () {
            openUploadModal(assoc.qrId);
        });

        var btnDel = document.createElement('button');
        btnDel.className = 'btn-icon btn-delete';
        btnDel.innerHTML = '&#128465;';
        btnDel.setAttribute('aria-label', 'Elimina');
        btnDel.addEventListener('click', function () {
            openDeleteModal(assoc.qrId);
        });

        actions.appendChild(btnAddExtra);
        actions.appendChild(btnEdit);
        actions.appendChild(btnDel);

        // Mostra conteggio immagini extra
        var extraCount = (assoc.extraImages && assoc.extraImages.length) || 0;
        if (extraCount > 0) {
            var extraBadge = document.createElement('div');
            extraBadge.className = 'assoc-extra-count';
            extraBadge.textContent = '+' + extraCount + ' foto';
            info.appendChild(extraBadge);
        }

        li.appendChild(thumb);
        li.appendChild(info);
        li.appendChild(actions);
        return li;
    }

    // =========================================================================
    // MODALE: SCANSIONE QR (con conferma manuale)
    // =========================================================================

    async function openScanModal() {
        modalScan.classList.remove('hidden');
        scanStatus.textContent = 'Avvio fotocamera...';
        scanDetected.classList.add('hidden');
        btnScanConfirm.classList.add('hidden');
        scannedQrId = null;

        await new Promise(function (r) { setTimeout(r, 200); });

        try {
            if (!scanDetector && 'BarcodeDetector' in window) {
                scanDetector = new BarcodeDetector({ formats: ['qr_code'] });
            }

            var attempts = 0;
            while (attempts < 3) {
                try {
                    scanStream = await navigator.mediaDevices.getUserMedia({
                        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
                        audio: false
                    });
                    break;
                } catch (camErr) {
                    attempts++;
                    if (attempts >= 3) throw camErr;
                    await new Promise(function (r) { setTimeout(r, 500); });
                }
            }

            scanVideo.srcObject = scanStream;
            scanVideo.setAttribute('playsinline', '');
            scanVideo.setAttribute('autoplay', '');
            scanVideo.muted = true;

            await new Promise(function (resolve, reject) {
                scanVideo.onloadedmetadata = function () {
                    scanVideo.play().then(resolve).catch(reject);
                };
                setTimeout(function () {
                    scanVideo.play().then(resolve).catch(reject);
                }, 1000);
            });

            scanStatus.textContent = 'Inquadra un QR code nel riquadro...';
            scanLoop();
        } catch (err) {
            scanStatus.textContent = 'Errore: ' + err.message;
            console.error('Errore scan camera:', err);
        }
    }

    function closeScanModal() {
        modalScan.classList.add('hidden');
        stopScan();
        scannedQrId = null;
    }

    function stopScan() {
        if (scanAnimFrame) {
            cancelAnimationFrame(scanAnimFrame);
            scanAnimFrame = null;
        }
        if (scanStream) {
            scanStream.getTracks().forEach(function (t) { t.stop(); });
            scanStream = null;
        }
        scanVideo.srcObject = null;
    }

    /**
     * Verifica che tutti i corner points del QR siano dentro il rettangolo
     * verde (zona centrale 60% del video, cioè da 20% a 80% su ogni asse).
     */
    function isQrInsideTarget(cornerPoints) {
        if (!cornerPoints || cornerPoints.length < 4) return false;
        var vw = scanVideo.videoWidth;
        var vh = scanVideo.videoHeight;
        if (!vw || !vh) return false;

        var minX = vw * 0.20;
        var maxX = vw * 0.80;
        var minY = vh * 0.20;
        var maxY = vh * 0.80;

        for (var i = 0; i < cornerPoints.length; i++) {
            var p = cornerPoints[i];
            if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) {
                return false;
            }
        }
        return true;
    }

    function scanLoop() {
        if (!scanDetector || scanVideo.readyState < 2) {
            scanAnimFrame = requestAnimationFrame(scanLoop);
            return;
        }

        scanDetector.detect(scanVideo).then(function (barcodes) {
            // Filtra: accetta solo QR con tutti i corner points dentro il rettangolo
            var validQr = null;
            for (var i = 0; i < barcodes.length; i++) {
                if (isQrInsideTarget(barcodes[i].cornerPoints)) {
                    validQr = barcodes[i];
                    break;
                }
            }

            if (validQr) {
                scannedQrId = validQr.rawValue;
                scanDetectedValue.textContent = validQr.rawValue;
                scanDetected.classList.remove('hidden');
                btnScanConfirm.classList.remove('hidden');
                scanStatus.textContent = 'QR rilevato!';
            } else {
                if (scannedQrId) {
                    scannedQrId = null;
                    scanDetected.classList.add('hidden');
                    btnScanConfirm.classList.add('hidden');
                    scanStatus.textContent = 'Inquadra un QR code nel riquadro...';
                }
            }

            scanAnimFrame = requestAnimationFrame(scanLoop);
        }).catch(function () {
            scanAnimFrame = requestAnimationFrame(scanLoop);
        });
    }

    function confirmScan() {
        if (!scannedQrId) return;
        var qrId = scannedQrId;
        stopScan();
        closeScanModal();
        openUploadModal(qrId);
    }

    // =========================================================================
    // MODALE: UPLOAD IMMAGINE
    // =========================================================================

    function openUploadModal(qrId) {
        currentQrIdForUpload = qrId;
        currentFileForUpload = null;

        uploadQrId.textContent = qrId;
        uploadPreviewContainer.classList.add('hidden');
        uploadActions.classList.add('hidden');
        btnChooseImage.style.display = '';
        uploadFileInput.value = '';

        modalUpload.classList.remove('hidden');
    }

    function closeUploadModal() {
        modalUpload.classList.add('hidden');
        currentQrIdForUpload = null;
        currentFileForUpload = null;
        if (uploadPreview.src) {
            URL.revokeObjectURL(uploadPreview.src);
            uploadPreview.src = '';
        }
    }

    function onFileSelected() {
        var file = uploadFileInput.files[0];
        if (!file) return;
        currentFileForUpload = file;
        uploadPreview.src = URL.createObjectURL(file);
        uploadPreviewContainer.classList.remove('hidden');
        uploadActions.classList.remove('hidden');
        btnChooseImage.style.display = 'none';
    }

    async function saveUpload() {
        if (!currentQrIdForUpload || !currentFileForUpload) return;

        btnUploadSave.textContent = 'Salvataggio...';
        btnUploadSave.disabled = true;

        try {
            var blob = await resizeImage(currentFileForUpload, 1024);

            if (isExtraUpload) {
                await JarDB.addExtra(currentQrIdForUpload, blob);
            } else {
                await JarDB.save(currentQrIdForUpload, blob);
            }

            closeUploadModal();
            await loadList();
        } catch (err) {
            console.error('Errore salvataggio:', err);
            try {
                if (isExtraUpload) {
                    await JarDB.addExtra(currentQrIdForUpload, currentFileForUpload);
                } else {
                    await JarDB.save(currentQrIdForUpload, currentFileForUpload);
                }
                closeUploadModal();
                await loadList();
            } catch (err2) {
                alert('Errore salvataggio: ' + err2.message);
            }
        } finally {
            btnUploadSave.textContent = 'Salva';
            btnUploadSave.disabled = false;
            isExtraUpload = false;
        }
    }

    function resizeImage(file, maxSize) {
        return new Promise(function (resolve, reject) {
            var url = URL.createObjectURL(file);
            var img = new Image();
            img.onload = function () {
                var w = img.naturalWidth;
                var h = img.naturalHeight;
                if (w > maxSize || h > maxSize) {
                    if (w >= h) {
                        h = Math.round(h * (maxSize / w));
                        w = maxSize;
                    } else {
                        w = Math.round(w * (maxSize / h));
                        h = maxSize;
                    }
                }
                var canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                var c = canvas.getContext('2d');
                c.drawImage(img, 0, 0, w, h);
                URL.revokeObjectURL(url);
                canvas.toBlob(function (blob) {
                    if (blob) resolve(blob);
                    else reject(new Error('Errore conversione'));
                }, 'image/jpeg', 0.85);
            };
            img.onerror = function () {
                URL.revokeObjectURL(url);
                reject(new Error('Errore caricamento immagine'));
            };
            img.src = url;
        });
    }

    // =========================================================================
    // MODALE: ELIMINAZIONE
    // =========================================================================

    function openDeleteModal(qrId) {
        deleteTargetId = qrId;
        deleteQrIdEl.textContent = qrId;
        modalDelete.classList.remove('hidden');
    }

    function closeDeleteModal() {
        modalDelete.classList.add('hidden');
        deleteTargetId = null;
    }

    async function confirmDelete() {
        if (!deleteTargetId) return;
        try {
            await JarDB.delete(deleteTargetId);
            closeDeleteModal();
            await loadList();
        } catch (err) {
            alert('Errore eliminazione: ' + err.message);
        }
    }

    // =========================================================================
    // MODALE: UPLOAD IMMAGINE EXTRA (secondaria)
    // =========================================================================

    var isExtraUpload = false;

    function openExtraUploadModal(qrId) {
        isExtraUpload = true;
        currentQrIdForUpload = qrId;
        currentFileForUpload = null;

        uploadQrId.textContent = qrId + ' (immagine aggiuntiva)';
        uploadPreviewContainer.classList.add('hidden');
        uploadActions.classList.add('hidden');
        btnChooseImage.style.display = '';
        uploadFileInput.value = '';

        modalUpload.classList.remove('hidden');
    }

    // =========================================================================
    // EXPORT / IMPORT BACKUP (ZIP)
    // =========================================================================

    var btnExport = document.getElementById('btn-export');
    var btnImport = document.getElementById('btn-import');
    var importFileInput = document.getElementById('import-file-input');

    /**
     * Esporta tutte le associazioni come file ZIP:
     * - manifest.json: array di { qrId, filename, createdAt }
     * - images/: cartella con le immagini (nominate come qrId sanitizzato)
     */
    async function exportBackup() {
        btnExport.disabled = true;
        btnExport.textContent = 'Esportazione...';

        try {
            var associations = await JarDB.getAll();
            if (associations.length === 0) {
                alert('Nessuna associazione da esportare.');
                return;
            }

            var zip = new JSZip();
            var manifest = [];

            for (var i = 0; i < associations.length; i++) {
                var assoc = associations[i];
                var safeName = assoc.qrId.replace(/[^a-zA-Z0-9_\-:.]/g, '_');
                var ext = 'jpg';
                if (assoc.imageBlob && assoc.imageBlob.type === 'image/png') {
                    ext = 'png';
                }
                var filename = 'images/' + safeName + '.' + ext;

                var entry = {
                    qrId: assoc.qrId,
                    filename: filename,
                    extraFilenames: [],
                    createdAt: assoc.createdAt || null
                };

                if (assoc.imageBlob) {
                    zip.file(filename, assoc.imageBlob);
                }

                // Immagini extra
                var extras = assoc.extraImages || [];
                for (var j = 0; j < extras.length; j++) {
                    var extraExt = 'jpg';
                    if (extras[j] && extras[j].type === 'image/png') {
                        extraExt = 'png';
                    }
                    var extraFilename = 'images/' + safeName + '_extra' + (j + 1) + '.' + extraExt;
                    entry.extraFilenames.push(extraFilename);
                    zip.file(extraFilename, extras[j]);
                }

                manifest.push(entry);
            }

            zip.file('manifest.json', JSON.stringify(manifest, null, 2));

            var blob = await zip.generateAsync({ type: 'blob' });

            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'qr-jar-label-backup.zip';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Errore export:', err);
            alert('Errore durante l\'esportazione: ' + err.message);
        } finally {
            btnExport.disabled = false;
            btnExport.innerHTML = '&#8595; Esporta backup';
        }
    }

    /**
     * Importa associazioni da un file ZIP.
     * Sovrascrive associazioni con lo stesso qrId.
     */
    async function importBackup(file) {
        btnImport.disabled = true;
        btnImport.textContent = 'Importazione...';

        try {
            var zip = await JSZip.loadAsync(file);

            var manifestFile = zip.file('manifest.json');
            if (!manifestFile) {
                alert('File ZIP non valido: manca manifest.json');
                return;
            }

            var manifestText = await manifestFile.async('string');
            var manifest = JSON.parse(manifestText);

            var imported = 0;
            for (var i = 0; i < manifest.length; i++) {
                var entry = manifest[i];

                // Immagine principale
                var imgFile = zip.file(entry.filename);
                if (imgFile) {
                    var imgBlob = await imgFile.async('blob');
                    await JarDB.save(entry.qrId, imgBlob);
                    imported++;
                }

                // Immagini extra
                var extraFilenames = entry.extraFilenames || [];
                for (var j = 0; j < extraFilenames.length; j++) {
                    var extraFile = zip.file(extraFilenames[j]);
                    if (extraFile) {
                        var extraBlob = await extraFile.async('blob');
                        await JarDB.addExtra(entry.qrId, extraBlob);
                    }
                }
            }

            alert('Importate ' + imported + ' associazioni.');
            await loadList();
        } catch (err) {
            console.error('Errore import:', err);
            alert('Errore durante l\'importazione: ' + err.message);
        } finally {
            btnImport.disabled = false;
            btnImport.innerHTML = '&#8593; Importa backup';
        }
    }

    // =========================================================================
    // EVENT LISTENERS
    // =========================================================================

    btnAdd.addEventListener('click', openScanModal);
    btnScanConfirm.addEventListener('click', confirmScan);
    btnScanCancel.addEventListener('click', closeScanModal);

    btnChooseImage.addEventListener('click', function () {
        uploadFileInput.click();
    });
    uploadFileInput.addEventListener('change', onFileSelected);
    btnUploadSave.addEventListener('click', saveUpload);
    btnUploadCancel.addEventListener('click', closeUploadModal);
    btnUploadClose.addEventListener('click', closeUploadModal);

    btnDeleteConfirm.addEventListener('click', confirmDelete);
    btnDeleteCancel.addEventListener('click', closeDeleteModal);

    btnExport.addEventListener('click', exportBackup);
    btnImport.addEventListener('click', function () {
        importFileInput.click();
    });
    importFileInput.addEventListener('change', function () {
        var file = importFileInput.files[0];
        if (file) {
            importBackup(file);
            importFileInput.value = '';
        }
    });

    // =========================================================================
    // INIT
    // =========================================================================

    loadList();
})();
