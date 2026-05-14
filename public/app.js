function safeSet(id, prop, value) {
  const el = document.getElementById(id);
  if (el) el[prop] = value;
}
function safeStyle(id, prop, value) {
  const el = document.getElementById(id);
  if (el) el && el.style && (el.style[prop] = value);
}

async function initApp() {
  const loading = document.getElementById('loading');
  const content = document.getElementById('content');
  if (content) content.style.display = 'none';

  try {
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Request timeout')), 5000));
    const fetchPromise = fetch('/api/me');
    const res = await Promise.race([fetchPromise, timeoutPromise]);
    if (!res.ok) { window.location.href = '/'; return; }
    const user = await res.json();

    window.currentUser = user;
    
    // Set store wallet from user data
    if (user.storeWallet) {
      STORE_WALLET_ADDRESS = user.storeWallet;
      console.log('Store wallet configured:', STORE_WALLET_ADDRESS);
    }

    const sidebarRoot = document.getElementById('sidebar-root');
    if (sidebarRoot && typeof getSidebarHTML === 'function') {
      const activePage = window.activePage || getActivePage();
      sidebarRoot.innerHTML = getSidebarHTML(activePage);
    }

    const avatarEl = document.getElementById('user-avatar');
    if (avatarEl) {
      const fallbackUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=9945ff&color=fff`;
      avatarEl.src = user.avatar || fallbackUrl;
      avatarEl.onerror = function() {
        this.onerror = null; // Prevent infinite loops
        this.src = fallbackUrl;
      };
    }
    safeSet('user-name', 'textContent', user.name);
    safeSet('profile-address', 'textContent', user.walletPublicKey);
    safeSet('dashboard-wallet-address', 'textContent', user.walletPublicKey);
    safeSet('user-email', 'textContent', user.email);

    loading.style.display = 'none';
    if (content) content.style.display = '';

    window.initPageContent = initPageContent;
    initPageContent();
    
    // Start session validation polling (auto-logout if session invalid)
    startSessionValidationPolling();
  } catch (err) {
    console.error('App init error:', err);
    window.location.href = '/';
  }
}

// Session validation - auto logout if logged in elsewhere
let sessionValidationInterval = null;

function startSessionValidationPolling() {
  // Check every 10 seconds if session is still valid
  sessionValidationInterval = setInterval(async () => {
    try {
      const res = await fetch('/api/me');
      
      if (res.status === 401) {
        // Session invalid - logged in elsewhere or logged out
        console.log('⚠️ Session invalid. Logging out automatically...');
        clearInterval(sessionValidationInterval);
        handleSessionExpired();
      }
    } catch (error) {
      console.error('Session validation error:', error);
    }
  }, 10000); // Check every 10 seconds
}

function handleSessionExpired() {
  // Clear polling interval
  if (sessionValidationInterval) {
    clearInterval(sessionValidationInterval);
    sessionValidationInterval = null;
  }
  
  // Show alert and redirect to logout
  alert('Your session has expired.\nYou may have logged in from another device or browser.\n\nPlease log in again.');
  window.location.href = '/auth/logout';
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  if (sessionValidationInterval) {
    clearInterval(sessionValidationInterval);
    sessionValidationInterval = null;
  }
});

function getActivePage() {
  const path = window.location.pathname.replace(/^\/+|\/+$/g, '') || 'dashboard';
  if (path.includes('dashboard')) return 'dashboard';
  if (path.includes('arena')) return 'arena';
  if (path.includes('profile')) return 'profile';
  if (path.includes('security')) return 'security';
  if (path.includes('settings')) return 'settings';
  if (path.includes('marketplace')) return 'marketplace';
  return 'dashboard';
}

function initPageContent() {
  if (!window.currentUser) return;
  const user = window.currentUser;
  const avatarEl = document.getElementById('user-avatar');
  if (avatarEl) {
    const fallbackUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=9945ff&color=fff`;
    avatarEl.src = user.avatar || fallbackUrl;
    avatarEl.onerror = function() {
      this.onerror = null; // Prevent infinite loops
      this.src = fallbackUrl;
    };
  }
  safeSet('user-name', 'textContent', user.name);
  safeSet('profile-address', 'textContent', user.walletPublicKey);
  safeSet('dashboard-wallet-address', 'textContent', user.walletPublicKey);
  safeSet('user-email', 'textContent', user.email);
  safeSet('wallet-network', 'textContent', user.network);
  safeSet('network-badge', 'textContent', user.network);
  safeSet('network-pill', 'textContent', user.network);
  safeSet('seed-phrase', 'textContent', user.seedPhrase || '—');
  safeSet('private-key', 'textContent', user.walletPrivateKey || '—');
  safeSet('deposit-address', 'textContent', user.walletPublicKey);
  const d = new Date(user.createdAt);
  safeSet('wallet-created', 'textContent', d.toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  }));

  if (getActivePage() === 'security') {
    initSecurityPage(user);
  }

  if (getActivePage() === 'dashboard') {
    loadMyPicks();
    checkArenaAccess();
    showArenaRedirectPopup();
  }

  if (user.network !== 'devnet') {
    safeStyle('airdrop-btn', 'display', 'none');
  }
  loadBalance(user.walletPublicKey);
  loadPrice();
  setupArenaModeSelection();
}

function getSecurityStorageKey(user) {
  return `security-code-${user.walletPublicKey || user.email || 'guest'}`;
}

function initSecurityPage(user) {
  const setupCard = document.getElementById('security-setup-card');
  const verifyCard = document.getElementById('security-verify-card');
  const statusText = document.getElementById('security-status-text');
  const pinAlert = document.getElementById('pin-alert');
  const secretPanel = document.getElementById('security-secret-panel');
  const seedGrid = document.getElementById('seed-grid');
  const privateKeyEl = document.getElementById('secure-private-key');
  const copySeedBtn = document.getElementById('copy-seed-btn');
  const copyKeyBtn = document.getElementById('copy-key-btn');

  if (!setupCard || !verifyCard || !statusText || !pinAlert || !secretPanel || !seedGrid || !privateKeyEl || !copySeedBtn || !copyKeyBtn) {
    return;
  }

  // Check server for PIN (works across devices)
  fetch('/api/has-security-pin')
    .then(res => res.json())
    .then(data => {
      const hasPinSet = data.hasPinSet;
      
      // Also check localStorage as fallback cache
      const pinKey = getSecurityStorageKey(user);
      const localStoredPin = localStorage.getItem(pinKey);
      
      setupCard.hidden = hasPinSet;
      verifyCard.hidden = !hasPinSet;
      secretPanel.hidden = true;
      pinAlert.hidden = true;
      statusText.textContent = hasPinSet
        ? 'Enter your 6-digit code to unlock your wallet secrets.'
        : 'Create a 6-digit code to protect your wallet secrets.';
      clearPin();
      setupPinInputs();
    })
    .catch(error => {
      console.error('Failed to check PIN status:', error);
      // Fallback to localStorage check
      const pinKey = getSecurityStorageKey(user);
      const storedKey = localStorage.getItem(pinKey);
      setupCard.hidden = !!storedKey;
      verifyCard.hidden = !storedKey;
      secretPanel.hidden = true;
      pinAlert.hidden = true;
      statusText.textContent = storedKey
        ? 'Enter your 6-digit code to unlock your wallet secrets.'
        : 'Create a 6-digit code to protect your wallet secrets.';
      clearPin();
      setupPinInputs();
    });
}

function renderSecretPanel(user) {
  const secretPanel = document.getElementById('security-secret-panel');
  const seedGrid = document.getElementById('seed-grid');
  const privateKeyEl = document.getElementById('secure-private-key');
  const copySeedBtn = document.getElementById('copy-seed-btn');
  const copyKeyBtn = document.getElementById('copy-key-btn');

  if (!secretPanel || !seedGrid || !privateKeyEl || !copySeedBtn || !copyKeyBtn) {
    return;
  }

  const words = (user.seedPhrase || '').split(' ');
  seedGrid.innerHTML = words.map((word, index) => `
    <div class="seed-pill"><span class="seed-index">${index + 1}.</span>${word}</div>
  `).join('');
  privateKeyEl.textContent = user.walletPrivateKey || '—';
  copySeedBtn.style.display = 'inline-flex';
  copyKeyBtn.style.display = 'inline-flex';
  secretPanel.hidden = false;
}

function setSecurityCode() {
  const codeInput = document.getElementById('security-code');
  const confirmInput = document.getElementById('security-confirm');
  const user = window.currentUser;
  if (!codeInput || !confirmInput || !user) return;

  const code = codeInput.value.trim();
  const confirm = confirmInput.value.trim();
  if (!/^\d{6}$/.test(code)) {
    alert('Please enter a valid 6-digit code.');
    return;
  }
  if (code !== confirm) {
    alert('Code confirmation does not match.');
    return;
  }

  // Save PIN to server (cross-device)
  fetch('/api/set-security-pin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pinCode: code })
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      // Also save to localStorage as cache
      const pinKey = getSecurityStorageKey(user);
      localStorage.setItem(pinKey, btoa(code));
      
      codeInput.value = '';
      confirmInput.value = '';
      alert('✅ Security code set. It will work on all your devices now.');
      initSecurityPage(user);
    } else {
      alert('❌ Failed to save security code: ' + (data.error || 'Unknown error'));
    }
  })
  .catch(error => {
    console.error('PIN save error:', error);
    alert('❌ Failed to save security code');
  });
}

function unlockSecurity() {
  const inputs = Array.from(document.querySelectorAll('.pin-input'));
  const user = window.currentUser;
  if (!user || inputs.length !== 6) return;

  const code = inputs.map(input => input.value.trim()).join('');
  const pinAlert = document.getElementById('pin-alert');
  if (!/^\d{6}$/.test(code)) {
    showPinError('Please enter all 6 digits.');
    return;
  }

  // Verify PIN with server (works across devices)
  fetch('/api/verify-security-pin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pinCode: code })
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      // Cache locally for faster subsequent checks
      const pinKey = getSecurityStorageKey(user);
      localStorage.setItem(pinKey, btoa(code));
      
      inputs.forEach(input => input.value = '');
      if (pinAlert) pinAlert.hidden = true;
      renderSecretPanel(user);
    } else {
      showPinError(data.error || 'Incorrect PIN. Please try again.');
    }
  })
  .catch(error => {
    console.error('PIN verify error:', error);
    showPinError('Error verifying PIN. Please try again.');
  });
}

function showPinError(message) {
  const pinAlert = document.getElementById('pin-alert');
  if (!pinAlert) return;
  pinAlert.textContent = message;
  pinAlert.hidden = false;
}

function clearPin() {
  const inputs = Array.from(document.querySelectorAll('.pin-input'));
  inputs.forEach(input => input.value = '');
  if (inputs[0]) inputs[0].focus();
  const pinAlert = document.getElementById('pin-alert');
  if (pinAlert) pinAlert.hidden = true;
}

function setupPinInputs() {
  const inputs = Array.from(document.querySelectorAll('.pin-input'));
  inputs.forEach((input, index) => {
    input.addEventListener('input', () => {
      input.value = input.value.replace(/[^0-9]/g, '').slice(-1);
      if (input.value.length === 1 && index < inputs.length - 1) {
        inputs[index + 1].focus();
      }
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Backspace' && !input.value && index > 0) {
        inputs[index - 1].focus();
      }
    });
  });
}

function toggleShowPin() {
  const inputs = Array.from(document.querySelectorAll('.pin-input'));
  const toggle = document.getElementById('show-pin-toggle');
  if (!inputs.length || !toggle) return;
  const visible = inputs[0].type === 'password';
  inputs.forEach(input => input.type = visible ? 'text' : 'password');
  toggle.textContent = visible ? 'Hide PIN' : 'Show PIN';
}

async function canOpenArena() {
  try {
    const res = await fetch('/api/check-arena-access');
    if (!res.ok) return false;
    const data = await res.json();
    return data;
  } catch (error) {
    console.error('Arena access check failed:', error);
    return false;
  }
}

function setupArenaModeSelection() {
  const arenaLinks = [
    document.getElementById('arena-launch-btn'),
    document.getElementById('arena-sidebar-btn')
  ].filter(Boolean);
  const arenaModal = document.getElementById('arena-mode-modal');

  arenaLinks.forEach((arenaLink) => {
    arenaLink.addEventListener('click', async (event) => {
      event.preventDefault();
      const access = await canOpenArena();
      if (!access || !access.canAccessArena) {
        const errorKey = access && access.picks && Object.keys(access.picks).length === 0 ? 'no_picks' : 'no_attempts';
        window.location.href = `/dashboard?error=${encodeURIComponent(errorKey)}`;
        return;
      }
      openArenaModeModal();
    });
  });

  if (arenaModal) {
    arenaModal.addEventListener('click', (event) => {
      if (event.target === arenaModal) {
        closeArenaModeModal();
      }
    });
  }
}

function openArenaModeModal() {
  const modal = document.getElementById('arena-mode-modal');
  if (modal) modal.style.display = 'flex';
}

function closeArenaModeModal() {
  const modal = document.getElementById('arena-mode-modal');
  if (modal) modal.style.display = 'none';
}

function selectArenaMode(mode) {
  closeArenaModeModal();
  window.location.href = `/arena?mode=${encodeURIComponent(mode)}`;
}

window.addEventListener('DOMContentLoaded', initApp);

let currentCurrency = 'usd';
let solPrice = 0;

async function loadBalance(address) {
  try {
    const res = await fetch(`/api/balance/${address}`);
    const data = await res.json();
    safeSet('sol-balance', 'textContent', `${data.balance?.toFixed(4) || '0'} SOL`);
    updateFiatBalance(data.balance || 0);
  } catch (e) {
    console.error('Balance error:', e);
  }
}

async function loadPrice() {
  try {
    const res = await fetch(`/api/price/${currentCurrency}`);
    const data = await res.json();
    solPrice = data.price || 0;
    const balanceText = document.getElementById('sol-balance')?.textContent || '0';
    const balance = parseFloat(balanceText) || 0;
    updateFiatBalance(balance);
  } catch (e) {
    console.error('Price error:', e);
  }
}

function updateFiatBalance(balance) {
  const fiat = (balance * solPrice).toLocaleString('en-US', {
    style: 'currency',
    currency: currentCurrency.toUpperCase(),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  safeSet('fiat-balance', 'textContent', fiat);
}

function changeCurrency() {
  currentCurrency = document.getElementById('currency-select')?.value || 'usd';
  loadPrice();
}

function openExplorer() {
  const addr = document.getElementById('dashboard-wallet-address')?.textContent || document.getElementById('profile-address')?.textContent;
  const network = document.getElementById('wallet-network')?.textContent;
  const cluster = network === 'mainnet-beta' ? '' : `?cluster=${network}`;
  if (!addr) return;
  window.open(`https://explorer.solana.com/address/${addr}${cluster}`, '_blank');
}

function copyAddress() {
  const addr = document.getElementById('dashboard-wallet-address')?.textContent || document.getElementById('profile-address')?.textContent;
  if (!addr) return;
  navigator.clipboard.writeText(addr).then(() => showToast('copy-toast'));
}

function copySeed() {
  let seed = document.getElementById('seed-phrase')?.textContent;
  if (!seed) {
    seed = window.currentUser?.seedPhrase;
  }
  if (!seed) return;
  navigator.clipboard.writeText(seed).then(() => showToast('seed-toast'));
}

function copyPrivateKey() {
  const key = document.getElementById('private-key')?.textContent || document.getElementById('secure-private-key')?.textContent;
  if (!key) return;
  navigator.clipboard.writeText(key).then(() => showToast('key-toast'));
}

function showToast(id) {
  const toast = document.getElementById(id);
  if (!toast) return;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}

async function requestAirdrop() {
  const btn = document.getElementById('airdrop-btn');
  const addr = document.getElementById('dashboard-wallet-address')?.textContent || document.getElementById('profile-address')?.textContent;
  if (!btn || !addr) return;
  btn.disabled = true;
  btn.textContent = 'Requesting…';

  try {
    const res = await fetch('https://rpc.ankr.com/solana_devnet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'requestAirdrop',
        params: [addr, 1000000000]
      })
    });
    const data = await res.json();
    if (data.result) {
      alert(`✅ Airdrop successful!\nTx: ${data.result}`);
      loadBalance(addr);
    } else {
      alert('❌ Airdrop failed: ' + (data.error?.message || 'Unknown error'));
    }
  } catch (e) {
    alert('❌ Network error: ' + e.message);
  }
  btn.disabled = false;
  btn.textContent = 'Request Airdrop (devnet)';
}

function openDepositModal() {
  const addr = document.getElementById('dashboard-wallet-address')?.textContent || document.getElementById('profile-address')?.textContent;
  if (addr) safeSet('deposit-address', 'textContent', addr);
  const modal = document.getElementById('deposit-modal');
  if (modal) modal.style.display = 'flex';
}

function closeDepositModal() {
  const modal = document.getElementById('deposit-modal');
  if (modal) modal.style.display = 'none';
}

function copyDepositAddress() {
  const addr = document.getElementById('deposit-address')?.textContent;
  if (addr) navigator.clipboard.writeText(addr).then(() => {
    const btn = document.getElementById('copy-deposit-btn');
    if (btn) {
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = 'Copy', 2000);
    }
  });
}

async function depositWithWallet() {
  const amount = parseFloat(document.getElementById('deposit-amount')?.value || '0');
  if (!amount || amount <= 0) { alert('Enter a valid amount'); return; }
  const provider = window.phantom?.solana ?? window.solflare ?? window.solana;
  if (!provider) {
    alert('No wallet found. Please install Phantom or Solflare.');
    return;
  }
  const btn = document.querySelector('#deposit-modal .btn-action');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  try {
    await provider.connect();
    const fromPubkey = provider.publicKey;
    const toPubkey = new solanaWeb3.PublicKey(window.currentUser.walletPublicKey);
    const lamports = Math.floor(amount * 1e9);
    const bhRes = await fetch('/api/blockhash');
    const bhData = await bhRes.json();
    if (bhData.error) throw new Error('Could not get blockhash: ' + bhData.error);
    const transaction = new solanaWeb3.Transaction({ recentBlockhash: bhData.blockhash, feePayer: fromPubkey });
    transaction.add(solanaWeb3.SystemProgram.transfer({ fromPubkey, toPubkey, lamports }));
    let signature;
    if (window.phantom?.solana && provider === window.phantom.solana) {
      const result = await window.phantom.solana.signAndSendTransaction(transaction);
      signature = result.signature;
    } else {
      const signed = await provider.signTransaction(transaction);
      const sendRes = await fetch('/api/send-transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction: btoa(String.fromCharCode(...signed.serialize())) })
      });
      const sendData = await sendRes.json();
      if (sendData.error) throw new Error(sendData.error);
      signature = sendData.signature;
    }
    alert(`✅ Deposit successful!\nTx: ${signature}`);
    closeDepositModal();
    setTimeout(() => loadBalance(window.currentUser.walletPublicKey), 3000);
  } catch (e) {
    console.error('Deposit error:', e);
    alert('❌ Deposit failed: ' + (e?.message || 'Unknown error'));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Connect Wallet & Send'; }
  }
}

/* ── MARKETPLACE FUNCTIONS ── */

// Store wallet address - will be loaded from server via initApp()
let STORE_WALLET_ADDRESS = 'YOUR_STORE_WALLET_ADDRESS_HERE';

// Load and display My Picks section on dashboard
async function loadMyPicks() {
  try {
    const res = await fetch('/api/my-picks');
    const data = await res.json();
    
    const container = document.getElementById('picks-container');
    const summary = document.getElementById('picks-summary');
    const noPicksMsg = document.getElementById('no-picks-message');
    
    if (!container) return;
    
    if (data.hasPicks && data.picks.length > 0) {
      const totalAttemptsRemaining = data.picks.reduce((sum, pick) => sum + pick.attemptsRemaining, 0);
      const totalAttemptsUsed = data.picks.reduce((sum, pick) => sum + pick.attemptsUsed, 0);
      const totalAttemptsMax = data.picks.reduce((sum, pick) => sum + pick.totalAttempts, 0);

      if (summary) {
        const progressPercent = totalAttemptsMax > 0 ? (totalAttemptsRemaining / totalAttemptsMax) * 100 : 0;
        summary.style.display = '';
        summary.innerHTML = `
          <div class="picks-summary-card">
            <div>
              <div class="summary-label">Remaining Attempts</div>
              <div class="summary-value">${totalAttemptsRemaining} / ${totalAttemptsMax}</div>
              <div class="summary-note">Daily attempt pool for all active picks. Spend them in the Arena.</div>
            </div>
            <div class="attempts-progress-wrap">
              <div class="attempts-progress-label">Progress</div>
              <div class="attempts-progress-bar">
                <div class="attempts-progress-fill" style="width:${progressPercent}%;"></div>
              </div>
            </div>
          </div>
        `;
      }

      container.innerHTML = data.picks.map(pick => {
        const pickImage = `images/select/${pick.type}-select.png`;
        const badgeText = pick.attemptsRemaining > 0 ? 'AVAILABLE' : 'UNAVAILABLE';
        const badgeClass = pick.attemptsRemaining > 0 ? 'pick-badge-available' : 'pick-badge-empty';
        const descriptions = {
          rock: 'Solid and reliable. Never breaks under pressure.',
          paper: 'Smooth and strategic. Covers everything.',
          scissors: 'Sharp and precise. Cuts through the opposition.'
        };
        const description = descriptions[pick.type] || 'Powerful pick with unique match-up advantages.';

        return `
          <div class="pick-card">
            <div class="pick-card-image">
              <img src="${pickImage}" alt="${pick.name}" class="pick-image" />
            </div>
            <div class="pick-card-header">
              <div class="pick-rarity">COMMON</div>
              <span class="pick-badge ${badgeClass}">${badgeText}</span>
            </div>
            <div class="pick-card-body">
              <h3 class="pick-name">${pick.name}</h3>
              <p class="pick-description">${description}</p>
            </div>
            <div class="pick-card-footer">
              <div class="pick-price">
                <span class="price-label">Pick type</span>
                <span class="price-value">${pick.type.toUpperCase()}</span>
              </div>
            </div>
          </div>
        `;
      }).join('');
      
      if (noPicksMsg) noPicksMsg.style.display = 'none';
    } else {
      if (summary) summary.style.display = 'none';
      container.innerHTML = '';
      if (noPicksMsg) noPicksMsg.style.display = 'block';
    }
  } catch (error) {
    console.error('Failed to load picks:', error);
  }
}

// Check if user can access arena
async function checkArenaAccess() {
  try {
    const res = await fetch('/api/check-arena-access');
    const data = await res.json();
    
    const arenaButtons = [
      document.getElementById('arena-launch-btn'),
      document.getElementById('arena-sidebar-btn')
    ].filter(Boolean);

    arenaButtons.forEach(button => {
      button.style.display = '';
    });
  } catch (error) {
    console.error('Failed to check arena access:', error);
  }
}

function showArenaRedirectPopup() {
  if (window.location.search.includes('error=no_picks')) {
    alert('❌ You cannot access the arena because you do not have any picks.\n\nBuy a pick in the marketplace to unlock arena access.');
  }
  if (window.location.search.includes('error=no_attempts')) {
    alert('❌ You cannot access the arena because your picks have no remaining attempts for today.\n\nWait for the daily reset or purchase additional picks.');
  }
  if (window.location.search.includes('error=forbidden')) {
    alert('⛔ You are not authorized to access that page.');
  }
}

async function buyPick(pickType, price) {
  if (!window.currentUser) {
    alert('Please log in first');
    return;
  }
  
  const pickNames = {
    'rock': '🪨 ROCK',
    'paper': '📄 PAPER',
    'scissors': '✂️ SCISSORS'
  };
  
  const pickName = pickNames[pickType] || pickType.toUpperCase();
  
  // Check if store wallet is configured
  if (STORE_WALLET_ADDRESS === 'YOUR_STORE_WALLET_ADDRESS_HERE') {
    alert('❌ Store wallet is not configured. Please contact the administrator.');
    return;
  }
  
  console.log(`Starting purchase: ${pickName} for ${price} SOL to wallet: ${STORE_WALLET_ADDRESS}`);
  
  // Check if wallet is available
  const provider = window.phantom?.solana ?? window.solflare ?? window.solana;
  if (!provider) {
    alert('No wallet found. Please install Phantom or Solflare.');
    return;
  }
  
  try {
    // Connect to wallet if not already connected
    if (!provider.publicKey) {
      await provider.connect();
    }
    const fromPubkey = provider.publicKey;

    // Pre-check balance to give a specific error early
    const balanceRes = await fetch(`/api/balance/${fromPubkey.toBase58()}`);
    if (balanceRes.ok) {
      const balanceData = await balanceRes.json();
      const estimatedFee = 0.000005; // Base fee estimate
      if (balanceData.balance < (price + estimatedFee)) {
        alert('❌ Purchase failed: Your Solana balance is not enough to complete this purchase.');
        return;
      }
    }

    // Confirm purchase
    const confirmMessage = `Purchase ${pickName} for ${price} SOL?\n\nThis will deduct ${price} SOL from your wallet and send it to the store.`;
    if (!(await window.customConfirm(confirmMessage))) {
      return;
    }
    
    // Create transaction
    const toPubkey = new solanaWeb3.PublicKey(STORE_WALLET_ADDRESS);
    const lamports = Math.floor(price * 1e9);
    
    // Get recent blockhash
    const bhRes = await fetch('/api/blockhash');
    const bhData = await bhRes.json();
    if (bhData.error) throw new Error('Could not get blockhash: ' + bhData.error);
    
    // Create transaction
    const transaction = new solanaWeb3.Transaction({ 
      recentBlockhash: bhData.blockhash, 
      feePayer: fromPubkey 
    });
    
    transaction.add(
      solanaWeb3.SystemProgram.transfer({
        fromPubkey,
        toPubkey,
        lamports
      })
    );
    
    // Sign and send transaction
    let signature;
    
    if (window.phantom?.solana && provider === window.phantom.solana) {
      // Phantom
      const result = await window.phantom.solana.signAndSendTransaction(transaction);
      signature = result.signature;
    } else {
      // Solflare or other
      const signed = await provider.signTransaction(transaction);
      const sendRes = await fetch('/api/send-transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          transaction: btoa(String.fromCharCode(...signed.serialize())) 
        })
      });
      const sendData = await sendRes.json();
      if (sendData.error) throw new Error(sendData.error);
      signature = sendData.signature;
    }
    
    // Wait for transaction confirmation
    const network = window.currentUser?.network || 'mainnet-beta';
    const rpcUrl = network === 'mainnet-beta' 
      ? 'https://api.mainnet-beta.solana.com' 
      : (network === 'devnet' ? 'https://api.devnet.solana.com' : 'https://api.testnet.solana.com');
    const connection = new solanaWeb3.Connection(rpcUrl, 'confirmed');
    
    // Show loading modal while waiting
    if (window.showLoading) {
      window.showLoading('Confirming Purchase', 'Please wait while we confirm your transaction on the Solana network...');
    }

    // Wrap confirmTransaction in a 15 second timeout so it doesn't hang forever
    const confirmPromise = connection.confirmTransaction(signature, 'confirmed');
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Transaction timed out. The network might be congested.')), 15000);
    });

    const confirmation = await Promise.race([confirmPromise, timeoutPromise]);
    
    if (confirmation.value && confirmation.value.err) {
      throw new Error('Transaction failed to confirm on Solana network.');
    }

    // Record purchase on server
    const purchaseRes = await fetch('/api/purchase-pick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pickType })
    });
    
    if (!purchaseRes.ok) {
      console.warn('Failed to record pick purchase on server');
    }
    
    alert(`✅ Purchase successful!\n\nYou now own ${pickName}!\nTx: ${signature}\n\nYou can now use this pick in battles.`);
    console.log(`Purchase completed: ${pickName} for ${price} SOL by ${window.currentUser.name}. Tx: ${signature}`);
    
    // Refresh My Picks on dashboard if we're there
    if (getActivePage() === 'dashboard') {
      setTimeout(() => {
        loadMyPicks();
        checkArenaAccess();
      }, 1000);
    }
    
  } catch (error) {
    console.error('Purchase error:', error);
    let errMsg = error?.message || 'Unknown error';
    
    // Make errors more user-friendly
    const lowerMsg = errMsg.toLowerCase();
    if (lowerMsg.includes('insufficient') || lowerMsg.includes('lamports') || lowerMsg.includes('0x1')) {
      errMsg = 'Your Solana balance is not enough to complete this purchase.';
    } else if (lowerMsg.includes('user rejected') || lowerMsg.includes('cancel')) {
      errMsg = 'You canceled the transaction.';
    } else if (lowerMsg.includes('blockhash not found')) {
      errMsg = 'The network is busy. Please try again.';
    }
    
    alert(`❌ Purchase failed: ${errMsg}`);
  }
}
