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

    // Modale delete
    var modalDelete = document.getElementById('modal-delete');
    var deleteQrIdEl = document.getElementById('delete-qr-id');
    var btnDeleteConfirm = document.getElementById('btn-delete-confirm');
    var btnDeleteCancel = document.getElementById('btn-delete-cancel');

    // Stato
    var scanStream = null;
    var scanDetector = null;
    var scanAnimFrame = null;
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

        // Ordina per data creazione (più recente prima)
        associations.sort(function (a, b) {
            return (b.createdAt || 0) - (a.createdAt || 0);
        });

        for (var i = 0; i < associations.length; i++) {
            var assoc = associations[i];
            listEl.appendChild(createListItem(assoc));
        }
    }

    function createListItem(assoc) {
        var li = document.createElement('li');
        li.className = 'assoc-item';

        // Thumbnail
        var thumb = document.createElement('img');
        thumb.className = 'assoc-thumb';
        if (assoc.imageBlob) {
            thumb.src = URL.createObjectURL(assoc.imageBlob);
        }
        thumb.alt = assoc.qrId;

        // Info
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

        // Azioni
        var actions = document.createElement('div');
        actions.className = 'assoc-actions';

        var btnEdit = document.createElement('button');
        btnEdit.className = 'btn-icon btn-edit';
        btnEdit.innerHTML = '&#9998;'; // ✎
        btnEdit.setAttribute('aria-label', 'Modifica immagine');
        btnEdit.addEventListener('click', function () {
            openUploadModal(assoc.qrId);
        });

        var btnDel = document.createElement('button');
        btnDel.className = 'btn-icon btn-delete';
        btnDel.innerHTML = '&#128465;'; // 🗑
        btnDel.setAttribute('aria-label', 'Elimina');
        btnDel.addEventListener('click', function () {
            openDeleteModal(assoc.qrId);
        });

        actions.appendChild(btnEdit);
        actions.appendChild(btnDel);

        li.appendChild(thumb);
        li.appendChild(info);
        li.appendChild(actions);

        return li;
    }

    // =========================================================================
    // MODALE: SCANSIONE QR
    // =========================================================================

    async function openScanModal() {
        modalScan.classList.remove('hidden');
        scanStatus.textContent = 'Inquadra un QR code...';

        try {
            // Inizializza detector
            if (!scanDetector && 'BarcodeDetector' in window) {
                scanDetector = new BarcodeDetector({ formats: ['qr_code'] });
            }

            // Avvia fotocamera
            scanStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
                audio: false
            });
            scanVideo.srcObject = scanStream;
            await scanVideo.play();

            // Avvia detection loop
            scanLoop();
        } catch (err) {
            scanStatus.textContent = 'Errore fotocamera: ' + err.message;
        }
    }

    function closeScanModal() {
        modalScan.classList.add('hidden');
        stopScan();
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

    function scanLoop() {
        if (!scanDetector || scanVideo.readyState < 2) {
            scanAnimFrame = requestAnimationFrame(scanLoop);
            return;
        }

        scanDetector.detect(scanVideo).then(function (barcodes) {
            if (barcodes.length > 0) {
                var qrId = barcodes[0].rawValue;
                scanStatus.textContent = 'Rilevato: ' + qrId;
                stopScan();

                // Breve pausa poi apri upload
                setTimeout(function () {
                    closeScanModal();
                    openUploadModal(qrId);
                }, 500);
                return;
            }
            scanAnimFrame = requestAnimationFrame(scanLoop);
        }).catch(function () {
            scanAnimFrame = requestAnimationFrame(scanLoop);
        });
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

        // Mostra anteprima
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
            // Ridimensiona
            var blob = await resizeImage(currentFileForUpload, 1024);
            await JarDB.save(currentQrIdForUpload, blob);
            closeUploadModal();
            await loadList();
        } catch (err) {
            console.error('Errore salvataggio:', err);
            // Fallback: salva originale
            try {
                await JarDB.save(currentQrIdForUpload, currentFileForUpload);
                closeUploadModal();
                await loadList();
            } catch (err2) {
                alert('Errore salvataggio: ' + err2.message);
            }
        } finally {
            btnUploadSave.textContent = 'Salva';
            btnUploadSave.disabled = false;
        }
    }

    /**
     * Ridimensiona immagine (stessa logica di app.js).
     */
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
                    if (blob) {
                        resolve(blob);
                    } else {
                        reject(new Error('Errore conversione'));
                    }
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
    // EVENT LISTENERS
    // =========================================================================

    btnAdd.addEventListener('click', openScanModal);
    btnScanCancel.addEventListener('click', closeScanModal);

    btnChooseImage.addEventListener('click', function () {
        uploadFileInput.click();
    });
    uploadFileInput.addEventListener('change', onFileSelected);
    btnUploadSave.addEventListener('click', saveUpload);
    btnUploadCancel.addEventListener('click', closeUploadModal);

    btnDeleteConfirm.addEventListener('click', confirmDelete);
    btnDeleteCancel.addEventListener('click', closeDeleteModal);

    // =========================================================================
    // INIT
    // =========================================================================

    loadList();
})();
