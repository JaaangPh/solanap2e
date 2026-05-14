// custom-alert.js

(function() {
  // Inject the HTML structure for the custom alert
  const modalHTML = `
    <div id="custom-alert-overlay" class="custom-alert-overlay">
      <div id="custom-alert-modal" class="custom-alert-modal">
        <button id="custom-alert-close" class="custom-alert-close">&times;</button>
        <div class="custom-alert-content">
          <div id="custom-alert-icon" class="custom-alert-icon"></div>
          <div class="custom-alert-text">
            <h2 id="custom-alert-title" class="custom-alert-title"></h2>
            <p id="custom-alert-message" class="custom-alert-message"></p>
          </div>
        </div>
        <div class="custom-alert-button-container">
          <button id="custom-alert-btn-cancel" class="custom-alert-button" style="display: none; margin-right: 12px; border-color: #555; color: #aaa;">Cancel</button>
          <button id="custom-alert-btn" class="custom-alert-button"></button>
        </div>
      </div>
    </div>
  `;

  document.addEventListener('DOMContentLoaded', () => {
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    const overlay = document.getElementById('custom-alert-overlay');
    const closeBtn = document.getElementById('custom-alert-close');
    const mainBtn = document.getElementById('custom-alert-btn');

    function hideAlert() {
      overlay.classList.remove('show');
    }

    closeBtn.addEventListener('click', hideAlert);
    mainBtn.addEventListener('click', hideAlert);
  });

  // Icons SVG
  const icons = {
    error: `<svg viewBox="0 0 24 24" fill="none" stroke="#ff4d4f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
    success: `<svg viewBox="0 0 24 24" fill="none" stroke="#52c41a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`,
    info: `<svg viewBox="0 0 24 24" fill="none" stroke="#1890ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`
  };

  // Store the original alert function just in case
  const originalAlert = window.alert;

  // Override window.alert
  window.alert = function(message) {
    const overlay = document.getElementById('custom-alert-overlay');
    if (!overlay) {
      // Fallback if DOM is not ready
      return originalAlert(message);
    }

    const modal = document.getElementById('custom-alert-modal');
    const iconContainer = document.getElementById('custom-alert-icon');
    const titleEl = document.getElementById('custom-alert-title');
    const messageEl = document.getElementById('custom-alert-message');
    const btnEl = document.getElementById('custom-alert-btn');

    const btnCancelEl = document.getElementById('custom-alert-btn-cancel');

    // Remove any previous custom event handlers
    btnEl.onclick = null;
    btnCancelEl.onclick = null;
    document.getElementById('custom-alert-close').onclick = null;

    // Parse message to determine type
    let type = 'info';
    let title = 'Notification';
    let btnText = 'OK';
    let cleanMessage = String(message);

    if (cleanMessage.includes('❌') || cleanMessage.includes('⛔') || cleanMessage.toLowerCase().includes('error') || cleanMessage.toLowerCase().includes('failed')) {
      type = 'error';
      title = 'Ooops!';
      btnText = 'Try Again';
      cleanMessage = cleanMessage.replace('❌', '').replace('⛔', '').trim();
    } else if (cleanMessage.includes('✅') || cleanMessage.toLowerCase().includes('success')) {
      type = 'success';
      title = 'Success!';
      btnText = 'Continue';
      cleanMessage = cleanMessage.replace('✅', '').trim();
    }

    // Update modal content
    modal.className = `custom-alert-modal is-${type}`;
    iconContainer.innerHTML = icons[type];
    titleEl.textContent = title;
    messageEl.textContent = cleanMessage;
    btnEl.textContent = btnText;
    btnCancelEl.style.display = 'none';

    // Show modal
    overlay.classList.add('show');
  };

  window.customConfirm = function(message) {
    return new Promise((resolve) => {
      const overlay = document.getElementById('custom-alert-overlay');
      if (!overlay) {
        return resolve(window.confirm(message));
      }

      const modal = document.getElementById('custom-alert-modal');
      const iconContainer = document.getElementById('custom-alert-icon');
      const titleEl = document.getElementById('custom-alert-title');
      const messageEl = document.getElementById('custom-alert-message');
      const btnEl = document.getElementById('custom-alert-btn');
      const btnCancelEl = document.getElementById('custom-alert-btn-cancel');
      const closeBtn = document.getElementById('custom-alert-close');

      // Update modal content to look like an info/confirm dialog
      modal.className = `custom-alert-modal is-info`;
      iconContainer.innerHTML = icons['info'];
      titleEl.textContent = 'Confirm Action';
      messageEl.textContent = String(message);
      btnEl.textContent = 'Confirm';
      btnCancelEl.style.display = 'inline-block';

      function cleanup() {
        overlay.classList.remove('show');
        btnEl.onclick = null;
        btnCancelEl.onclick = null;
        closeBtn.onclick = null;
      }

      btnEl.onclick = () => {
        cleanup();
        resolve(true);
      };

      btnCancelEl.onclick = () => {
        cleanup();
        resolve(false);
      };

      closeBtn.onclick = () => {
        cleanup();
        resolve(false);
      };

      // Show modal
      overlay.classList.add('show');
    });
  };

  window.showLoading = function(title, message) {
    const overlay = document.getElementById('custom-alert-overlay');
    if (!overlay) return;

    const modal = document.getElementById('custom-alert-modal');
    const iconContainer = document.getElementById('custom-alert-icon');
    const titleEl = document.getElementById('custom-alert-title');
    const messageEl = document.getElementById('custom-alert-message');
    const btnEl = document.getElementById('custom-alert-btn');
    const btnCancelEl = document.getElementById('custom-alert-btn-cancel');
    const closeBtn = document.getElementById('custom-alert-close');

    // Remove any previous custom event handlers so they can't dismiss it
    btnEl.onclick = null;
    btnCancelEl.onclick = null;
    closeBtn.onclick = null;

    modal.className = `custom-alert-modal is-info`;
    iconContainer.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="#1890ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="loading-spinner"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>`;
    titleEl.textContent = title;
    messageEl.textContent = String(message);
    
    // Hide buttons
    btnEl.style.display = 'none';
    btnCancelEl.style.display = 'none';
    closeBtn.style.display = 'none';

    overlay.classList.add('show');
  };
})();
