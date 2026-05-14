
function getSidebarHTML(activePage) {
  const isAdmin = window.currentUser?.email?.toLowerCase() === 'ghostnetwork30@gmail.com';
  return `
    <aside class="sidebar">
      <div class="sidebar-brand">
        <div class="brand-title">SOL CLASH</div>
        <div class="brand-subtitle">PLAY &bull; EARN &bull; DOMINATE</div>
      </div>

      <div class="sidebar-profile">
        <div class="profile-avatar-wrap">
          <img id="user-avatar" class="profile-avatar" src="" alt="Avatar" />
          <div class="status-dot"></div>
        </div>
        <div class="profile-info">
          <div class="profile-name" id="user-name">—</div>
          <div class="profile-address" id="profile-address">—</div>
        </div>
      </div>

      <nav class="sidebar-nav">
        <div class="nav-group" id="group-main">
          <div class="nav-title">MAIN</div>
          <a href="/dashboard" class="nav-item ${activePage === 'dashboard' ? 'active' : ''}">
            <span class="nav-icon">⬡</span>
            Dashboard
          </a>
          <a href="/arena" id="arena-sidebar-btn" class="nav-item ${activePage === 'arena' ? 'active' : ''}">
            <span class="nav-icon">⚔</span>
            Arena
            <span class="badge badge-live">LIVE</span>
          </a>
          <a href="/leaderboard" class="nav-item">
            <span class="nav-icon">🏆</span>
            Leaderboard
          </a>
          <a href="/marketplace" class="nav-item ${activePage === 'marketplace' ? 'active' : ''}">
            <span class="nav-icon">🛒</span>
            Marketplace
          </a>
        </div>

        <div class="nav-group" id="group-earn">
          <div class="nav-title">EARN</div>
          <a href="#" class="nav-item" style="cursor: not-allowed; opacity: 0.5;">
            <span class="nav-icon">⬨</span>
            Staking
          </a>
          <a href="#" class="nav-item" style="cursor: not-allowed; opacity: 0.5;">
            <span class="nav-icon">◎</span>
            Token Swap
          </a>
          <a href="#" class="nav-item" style="cursor: not-allowed; opacity: 0.5;">
            <span class="nav-icon">⇅</span>
            Transactions
          </a>
        </div>

        <div class="nav-group" id="group-account">
          <div class="nav-title">ACCOUNT</div>
          <a href="/profile" class="nav-item ${activePage === 'profile' ? 'active' : ''}">
            <span class="nav-icon">👤</span>
            Profile
          </a>
          <a href="/security" class="nav-item ${activePage === 'security' ? 'active' : ''}">
            <span class="nav-icon">🔐</span>
            Security
          </a>
          <a href="/settings" class="nav-item ${activePage === 'settings' ? 'active' : ''}">
            <span class="nav-icon">⚙️</span>
            Settings
          </a>
          ${isAdmin ? `
          <a href="/admin" class="nav-item ${activePage === 'admin' ? 'active' : ''}">
            <span class="nav-icon">🛠️</span>
            Admin
          </a>
          ` : ''}
          <a href="/auth/logout" class="nav-item mobile-only-logout">
            <span class="nav-icon">⍈</span>
            Log Out
          </a>
        </div>
      </nav>

      <div class="sidebar-logout-container" style="margin-top: auto; padding: 20px; border-top: 1px solid rgba(153,69,255,0.2);">
        <a href="/auth/logout" class="sidebar-logout">
          <span class="icon" style="font-size: 18px; margin-right: 10px;">⍈</span> LOG OUT
        </a>
      </div>
    </aside>
    <div id="arena-mode-modal" class="modal-overlay arena-mode-modal">
      <div class="modal arena-mode-panel">
        <div class="arena-modal-header">
          <div>
            <div class="arena-modal-badge">PVP ARENA</div>
            <h3>Choose your battle path</h3>
          </div>
          <button class="modal-close" onclick="closeArenaModeModal()">&times;</button>
        </div>
        <div class="modal-body">
          <p class="arena-modal-copy">Deploy your squad and lock in the arena mode. Solo entries are tactical, duels are raw.</p>
          <div class="arena-mode-grid">
            <button class="btn-action arena-mode-btn arena-single" type="button" onclick="selectArenaMode('singleplayer')">
              <span class="arena-mode-icon">🧠</span>
              <span>
                <strong>Singleplayer</strong>
                <span class="mode-tag">Solo run</span>
              </span>
            </button>
            <button class="btn-action arena-mode-btn arena-multi" type="button" onclick="selectArenaMode('multiplayer')">
              <span class="arena-mode-icon">⚔️</span>
              <span>
                <strong>Multiplayer</strong>
                <span class="mode-tag">Duel live</span>
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>

      <div class="mobile-bottom-bar">
        <button class="mobile-tab active" onclick="toggleMobileTab('group-main')">
          <span class="tab-icon">⬡</span>
          <span class="tab-label">Home</span>
        </button>
        <button class="mobile-tab" onclick="toggleMobileTab('group-earn')">
          <span class="tab-icon">◎</span>
          <span class="tab-label">Earn</span>
        </button>
        <button class="mobile-tab" onclick="toggleMobileTab('group-account')">
          <span class="tab-icon">◉</span>
          <span class="tab-label">Account</span>
        </button>
      </div>
    `;
}

function toggleMobileTab(groupId) {
  if (window.innerWidth > 850) return;
  
  const groups = document.querySelectorAll('.nav-group');
  const tabs = document.querySelectorAll('.mobile-tab');
  const nav = document.querySelector('.sidebar-nav');
  
  const isAlreadyActive = document.getElementById(groupId).classList.contains('mobile-active');
  
  groups.forEach(g => g.classList.remove('mobile-active'));
  tabs.forEach(t => t.classList.remove('active'));
  
  if (isAlreadyActive) {
    nav.classList.remove('menu-open');
  } else {
    document.getElementById(groupId).classList.add('mobile-active');
    document.querySelector(`button[onclick="toggleMobileTab('${groupId}')"]`).classList.add('active');
    nav.classList.add('menu-open');
  }
}

document.addEventListener('click', (e) => {
  if (window.innerWidth > 850) return;
  const nav = document.querySelector('.sidebar-nav');
  const bottomBar = document.querySelector('.mobile-bottom-bar');
  if (nav && bottomBar && nav.classList.contains('menu-open') && !nav.contains(e.target) && !bottomBar.contains(e.target)) {
    nav.classList.remove('menu-open');
    document.querySelectorAll('.nav-group').forEach(g => g.classList.remove('mobile-active'));
    document.querySelectorAll('.mobile-tab').forEach(t => t.classList.remove('active'));
  }
});
