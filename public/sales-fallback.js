(() => {
  const normalizeDigits = (value) => String(value || '')
    .replace(/[０-９]/g, (char) => String(char.charCodeAt(0) - 0xfee0))
    .replace(/[^0-9]/g, '');

  const isReactReady = () => document.documentElement?.dataset?.ledgerReactReady === '1';

  const markJsOn = () => {
    document.querySelectorAll('[data-js-status]').forEach((node) => {
      node.textContent = 'ON';
      node.classList.remove('text-rose-700');
      node.classList.add('text-emerald-700');
    });
  };

  const inferCountsFromText = (text) => {
    const normalized = String(text || '')
      .replace(/[０-９]/g, (char) => String(char.charCodeAt(0) - 0xfee0))
      .replace(/\r/g, '\n');

    const byLabel = (patterns) => {
      for (const pattern of patterns) {
        const match = normalized.match(pattern);
        if (match?.[1]) {
          const value = Number(match[1]);
          if (Number.isFinite(value) && value >= 0 && value <= 200) {
            return value;
          }
        }
      }
      return 0;
    };

    const adult = byLabel([/大人[^\n]{0,20}?(\d{1,3})\s*(?:枚|人|名|件)?/, /1800円[^\n]{0,20}?(\d{1,3})\s*(?:枚|人|名|件)/]);
    const junior = byLabel([/(?:中高|高生|中高校生)[^\n]{0,20}?(\d{1,3})\s*(?:枚|人|名|件)?/, /1500円[^\n]{0,24}?(?:高生|中高|学生)[^\n]{0,12}?(\d{1,3})\s*(?:枚|人|名|件)/]);
    const child = byLabel([/(?:小人|小児|小学生|学生以下|子供|こども)[^\n]{0,20}?(\d{1,3})\s*(?:枚|人|名|件)?/, /1200円[^\n]{0,20}?(\d{1,3})\s*(?:枚|人|名|件)/]);
    const monk = byLabel([/坊主[^\n]{0,20}?(\d{1,3})\s*(?:枚|人|名|件)?/, /1500円[^\n]{0,20}?坊主[^\n]{0,12}?(\d{1,3})\s*(?:枚|人|名|件)/]);

    const total = adult + junior + child + monk;
    if (total <= 0) {
      return null;
    }

    return { adult, junior, child, monk };
  };

  const attachSalesFallback = () => {
    if (isReactReady()) {
      return;
    }

    const adultInput = document.getElementById('sales-count-adult');
    const juniorInput = document.getElementById('sales-count-junior');
    const childInput = document.getElementById('sales-count-child');
    const monkInput = document.getElementById('sales-count-monk');
    const totalNode = document.getElementById('sales-total-preview');
    const debugNode = document.getElementById('sales-debug-preview');
    const cameraInput = document.getElementById('sales-camera-input');
    const galleryInput = document.getElementById('sales-gallery-input');
    const previewWrap = document.getElementById('sales-preview-wrap');
    const previewName = document.getElementById('sales-preview-name');
    const existingImg = document.getElementById('sales-preview-image');
    const ocrWrap = document.getElementById('sales-ocr-wrap');
    const ocrStatus = document.getElementById('sales-ocr-status');
    const ocrText = document.getElementById('sales-ocr-text');
    const ocrReason = document.getElementById('sales-ocr-reason');

    if (!adultInput || !juniorInput || !childInput || !monkInput || !totalNode || !debugNode) {
      return;
    }

    if (adultInput.dataset.fallbackBound === '1') {
      return;
    }

    const calc = () => {
      const a = Number(normalizeDigits(adultInput.value || '0')) || 0;
      const j = Number(normalizeDigits(juniorInput.value || '0')) || 0;
      const c = Number(normalizeDigits(childInput.value || '0')) || 0;
      const m = Number(normalizeDigits(monkInput.value || '0')) || 0;
      const total = a * 1800 + j * 1500 + c * 1200 + m * 1500;
      totalNode.textContent = '¥' + total.toLocaleString();
      debugNode.textContent = 'debug: A' + a + ' / J' + j + ' / C' + c + ' / M' + m;
    };

    const onFile = (input) => {
      if (isReactReady()) {
        return;
      }

      const file = input.files && input.files[0];
      if (!file) {
        return;
      }

      if (previewName) {
        previewName.textContent = '添付画像: ' + file.name;
      }

      const url = URL.createObjectURL(file);
      let img = existingImg;
      if (!img && previewWrap) {
        img = document.createElement('img');
        img.id = 'sales-preview-image';
        img.alt = 'アップロードした日計表の画像プレビュー';
        img.className = 'max-h-56 w-full rounded-lg border border-orange-100 object-contain bg-stone-50';
        previewWrap.appendChild(img);
      }
      if (img) {
        img.src = url;
      }

      if (ocrWrap && !ocrStatus && !ocrText) {
        return;
      }

      const formData = new FormData();
      formData.append('file', file);

      fetch('/api/upload', { method: 'POST', body: formData })
        .then((response) => response.json())
        .then((payload) => {
          if (ocrStatus) {
            ocrStatus.textContent = 'OCR状態: ' + (payload?.ocrAvailable === false ? 'OFF' : 'ON');
          }

          const extractedText = typeof payload?.extractedText === 'string' ? payload.extractedText : '';
          if (ocrText) {
            ocrText.textContent = 'OCR先頭: ' + (extractedText ? extractedText.slice(0, 180) : '（空）');
          }
          if (ocrReason) {
            ocrReason.textContent = payload?.ocrReason ? String(payload.ocrReason) : '';
          }

          const suggestion = payload?.suggestion ?? null;
          let counts = null;

          if (suggestion?.breakdown) {
            counts = {
              adult: Number(suggestion.breakdown.adult?.count) || 0,
              junior: Number(suggestion.breakdown.junior?.count) || 0,
              child: Number(suggestion.breakdown.child?.count) || 0,
              monk: Number(suggestion.breakdown.monk?.count) || 0,
            };
          }

          if (!counts) {
            counts = inferCountsFromText(extractedText);
          }

          if (counts) {
            adultInput.value = String(counts.adult || '');
            juniorInput.value = String(counts.junior || '');
            childInput.value = String(counts.child || '');
            monkInput.value = String(counts.monk || '');

            [adultInput, juniorInput, childInput, monkInput].forEach((node) => {
              node.dispatchEvent(new Event('input', { bubbles: true }));
              node.dispatchEvent(new Event('change', { bubbles: true }));
            });

            calc();
          }
        })
        .catch(() => {
          if (ocrStatus) {
            ocrStatus.textContent = 'OCR状態: OFF';
          }
          if (ocrText) {
            ocrText.textContent = 'OCR先頭: （取得失敗）';
          }
          if (ocrReason) {
            ocrReason.textContent = 'OCR API呼び出しに失敗しました。';
          }
        });
    };

    [adultInput, juniorInput, childInput, monkInput].forEach((node) => {
      node.addEventListener('input', calc);
      node.addEventListener('change', calc);
    });

    [cameraInput, galleryInput].forEach((node) => {
      if (!node) {
        return;
      }
      node.addEventListener('change', () => onFile(node));
    });

    adultInput.dataset.fallbackBound = '1';
    calc();
  };

  const runBootstrap = () => {
    markJsOn();
    attachSalesFallback();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runBootstrap, { once: true });
  }

  runBootstrap();

  const retryTimer = setInterval(() => {
    runBootstrap();
  }, 500);

  const observer = new MutationObserver(() => {
    attachSalesFallback();
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }

  setTimeout(() => {
    clearInterval(retryTimer);
  }, 20000);

  window.addEventListener('beforeunload', () => {
    clearInterval(retryTimer);
    observer.disconnect();
  }, { once: true });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations()
      .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
      .catch(() => {});
  }

  if ('caches' in window) {
    caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))).catch(() => {});
  }
})();
