(function () {
    'use strict';

    // Elementi DOM
    var listEl = document.getElementById('associations-list');
    var emptyState = document.getElementById('empty-state');

    // Modale delete
    var modalDelete = document.getElementById('modal-delete');
    var deleteQrIdEl = document.getElementById('delete-qr-id');
    var btnDeleteConfirm = document.getElementById('btn-delete-confirm');
    var btnDeleteCancel = document.getElementById('btn-delete-cancel');

    // Backup
    var btnExport = document.getElementById('btn-export');
    var btnImport = document.getElementById('btn-import');
    var importFileInput = document.getElementById('import-file-input');

    // Stato
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

        var extraCount = (assoc.extraImages && assoc.extraImages.length) || 0;
        var countLabel = document.createElement('div');
        countLabel.className = 'assoc-extra-count';
        countLabel.textContent = (1 + extraCount) + ' immagin' + ((1 + extraCount) === 1 ? 'e' : 'i');

        info.appendChild(qrLabel);
        info.appendChild(dateLabel);
        info.appendChild(countLabel);

        var actions = document.createElement('div');
        actions.className = 'assoc-actions';

        // Pulsante apri galleria
        var btnGallery = document.createElement('button');
        btnGallery.className = 'btn-icon btn-edit';
        btnGallery.innerHTML = '&#128247;'; // 📷
        btnGallery.setAttribute('aria-label', 'Apri galleria');
        btnGallery.addEventListener('click', function () {
            window.location.href = 'gallery.html?qr=' + encodeURIComponent(assoc.qrId);
        });

        var btnDel = document.createElement('button');
        btnDel.className = 'btn-icon btn-delete';
        btnDel.innerHTML = '&#128465;';
        btnDel.setAttribute('aria-label', 'Elimina');
        btnDel.addEventListener('click', function () {
            openDeleteModal(assoc.qrId);
        });

        actions.appendChild(btnGallery);
        actions.appendChild(btnDel);

        li.appendChild(thumb);
        li.appendChild(info);
        li.appendChild(actions);
        return li;
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
    // EXPORT / IMPORT BACKUP (ZIP)
    // =========================================================================

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

            // Includi impostazioni
            var settings = {
                debounceMs: parseInt(localStorage.getItem('debounceMs') || '150', 10),
                imageScale: parseFloat(localStorage.getItem('imageScale') || '1')
            };
            zip.file('settings.json', JSON.stringify(settings, null, 2));

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

                var imgFile = zip.file(entry.filename);
                if (imgFile) {
                    var imgBlob = await imgFile.async('blob');
                    await JarDB.save(entry.qrId, imgBlob);
                    imported++;
                }

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

            // Ripristina impostazioni se presenti
            var settingsFile = zip.file('settings.json');
            if (settingsFile) {
                var settingsText = await settingsFile.async('string');
                var settings = JSON.parse(settingsText);
                if (settings.debounceMs) localStorage.setItem('debounceMs', settings.debounceMs.toString());
                if (settings.imageScale) localStorage.setItem('imageScale', settings.imageScale.toString());
                // Aggiorna UI slider
                debounceSlider.value = settings.debounceMs || 150;
                debounceValueLabel.textContent = (settings.debounceMs || 150) + 'ms';
            }
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
    // IMPOSTAZIONI
    // =========================================================================

    var debounceSlider = document.getElementById('debounce-slider');
    var debounceValueLabel = document.getElementById('debounce-value');

    // Carica valore salvato
    var savedDebounce = localStorage.getItem('debounceMs') || '150';
    debounceSlider.value = savedDebounce;
    debounceValueLabel.textContent = savedDebounce + 'ms';

    function onDebounceChange() {
        var val = debounceSlider.value;
        debounceValueLabel.textContent = val + 'ms';
        localStorage.setItem('debounceMs', val);
    }
    debounceSlider.addEventListener('input', onDebounceChange);
    debounceSlider.addEventListener('change', onDebounceChange);

    // =========================================================================
    // EVENT LISTENERS
    // =========================================================================

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
