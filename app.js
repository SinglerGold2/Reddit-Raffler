(function () {
  'use strict';

  // State
  let allPosts = [];
  let filteredPosts = [];
  let selectedIds = new Set();
  let afterCursor = null;

  // DOM refs
  const $ = (sel) => document.querySelector(sel);
  const subredditInput = $('#subreddit-input');
  const sortSelect = $('#sort-select');
  const fetchBtn = $('#fetch-btn');
  const fetchStatus = $('#fetch-status');
  const filterSection = $('#filter-section');
  const flairSelect = $('#flair-select');
  const dateFrom = $('#date-from');
  const dateTo = $('#date-to');
  const scoreMin = $('#score-min');
  const scoreMax = $('#score-max');
  const applyFiltersBtn = $('#apply-filters-btn');
  const filterSummary = $('#filter-summary');
  const postsSection = $('#posts-section');
  const postList = $('#post-list');
  const selectAllBtn = $('#select-all-btn');
  const deselectAllBtn = $('#deselect-all-btn');
  const loadMoreBtn = $('#load-more-btn');
  const selectedCount = $('#selected-count');
  const drawSection = $('#draw-section');
  const winnerCountInput = $('#winner-count');
  const uniqueUsersCheckbox = $('#unique-users');
  const excludeDeletedCheckbox = $('#exclude-deleted');
  const excludeAutomodCheckbox = $('#exclude-automod');
  const excludeModsCheckbox = $('#exclude-mods');
  const modStatus = $('#mod-status');
  const excludeUsersInput = $('#exclude-users-input');
  const verifiableDrawCheckbox = $('#verifiable-draw');
  const entropyGroup = $('#entropy-group');
  const externalEntropyInput = $('#external-entropy');
  const drawBtn = $('#draw-btn');
  const winnersSection = $('#winners-section');
  const winnersList = $('#winners-list');
  const verificationSection = $('#verification-section');
  const verifyCurrentBtn = $('#verify-current-btn');
  const copyProofBtn = $('#copy-proof-btn');
  const downloadProofBtn = $('#download-proof-btn');
  const verifyStatus = $('#verify-status');
  const precommitDetails = $('#precommit-details');
  const createPrecommitBtn = $('#create-precommit-btn');
  const drawFromCommitBtn = $('#draw-from-commit-btn');
  const precommitStatus = $('#precommit-status');
  const proofImportInput = $('#proof-import-input');
  const verifyImportBtn = $('#verify-import-btn');
  const verifyImportStatus = $('#verify-import-status');
  const rankingCriteriaGroup = $('#ranking-criteria-group');
  const rankingCriteria = $('#ranking-criteria');
  const modeBtns = document.querySelectorAll('.mode-btn');
  const postGenSection = $('#post-gen-section');
  const postTitleInput = $('#post-title-input');
  const postIntroInput = $('#post-intro-input');
  const postOutroInput = $('#post-outro-input');
  const prizesToggle = $('#prizes-toggle');
  const prizesList = $('#prizes-list');
  const generatePostBtn = $('#generate-post-btn');
  const generatedPostWrapper = $('#generated-post-wrapper');
  const generatedPostOutput = $('#generated-post-output');
  const copyPostBtn = $('#copy-post-btn');
  const copyFeedback = $('#copy-feedback');
  let drawMode = 'random';
  let currentWinners = [];
  let subredditMods = [];
  let lastVerification = null;
  let currentProofPackage = null;
  let pendingPreCommit = null;
  const RUN_HISTORY_KEY = 'raffler-run-history-v1';

  // ---- API ----
  // Try direct Reddit fetch first; fall back to local proxy on CORS error.
  async function fetchPosts(subreddit, sort, after) {
    const params = new URLSearchParams({ limit: '100', raw_json: '1' });
    if (after) params.set('after', after);
    const path = `r/${encodeURIComponent(subreddit)}/${sort}.json`;

    let json;
    try {
      const res = await fetch(`https://www.reddit.com/${path}?${params}`);
      json = await res.json();
    } catch {
      // CORS blocked — use local proxy fallback
      const res = await fetch(`/api/reddit/${path}?${params}`);
      if (!res.ok) {
        if (res.status === 404) throw new Error('Subreddit nicht gefunden');
        if (res.status === 403) throw new Error('Subreddit ist privat');
        if (res.status === 429) throw new Error('Rate-Limit erreicht — bitte kurz warten');
        throw new Error(`Reddit-Fehler: HTTP ${res.status}`);
      }
      json = await res.json();
    }

    if (json.error) {
      if (json.error === 404) throw new Error('Subreddit nicht gefunden');
      if (json.error === 403) throw new Error('Subreddit ist privat');
      if (json.error === 429) throw new Error('Rate-Limit erreicht — bitte kurz warten');
      throw new Error(json.message || `Reddit-Fehler: ${json.error}`);
    }

    const posts = (json.data?.children || []).map((child) => ({
      id: child.data.id,
      title: child.data.title,
      author: child.data.author,
      flair: child.data.link_flair_text || null,
      created: child.data.created_utc,
      score: child.data.score,
      numComments: child.data.num_comments,
      url: `https://www.reddit.com${child.data.permalink}`,
    }));

    return { posts, after: json.data?.after || null };
  }

  async function fetchMods(subreddit) {
    const path = `r/${encodeURIComponent(subreddit)}/about/moderators.json`;
    const params = new URLSearchParams({ raw_json: '1' });

    let json;
    try {
      const res = await fetch(`https://www.reddit.com/${path}?${params}`);
      json = await res.json();
    } catch {
      const res = await fetch(`/api/reddit/${path}?${params}`);
      json = await res.json();
    }

    if (json.error) {
      throw new Error(json.error === 403 ? 'Mod-Liste erfordert OAuth' : `HTTP ${json.error}`);
    }

    return (json.data?.children || []).map((c) => c.name);
  }

  // ---- Posts loading ----
  async function loadPosts(append = false) {
    const subreddit = subredditInput.value.trim();
    if (!subreddit) return;
    fetchBtn.disabled = true;
    loadMoreBtn.disabled = true;
    setStatus('loading', `Lade Posts von r/${subreddit}...`);

    try {
      const data = await fetchPosts(subreddit, sortSelect.value, append ? afterCursor : null);
      afterCursor = data.after;

      if (!append) {
        allPosts = [];
        selectedIds.clear();
        // Fetch mod list for the new subreddit
        subredditMods = [];
        excludeModsCheckbox.disabled = true;
        modStatus.className = 'mod-status loading';
        modStatus.textContent = '(laden...)';
        fetchMods(subreddit).then((mods) => {
          subredditMods = mods;
          excludeModsCheckbox.disabled = false;
          modStatus.className = 'mod-status loaded';
          modStatus.textContent = `(${mods.length} Mods geladen)`;
        }).catch(() => {
          subredditMods = [];
          excludeModsCheckbox.checked = false;
          excludeModsCheckbox.disabled = true;
          modStatus.className = 'mod-status error';
          modStatus.textContent = '(erfordert OAuth)';
        });
      }

      // Deduplicate by ID
      const existingIds = new Set(allPosts.map((p) => p.id));
      const newPosts = data.posts.filter((p) => !existingIds.has(p.id));
      allPosts = allPosts.concat(newPosts);

      setStatus('', `${allPosts.length} Posts geladen`);
      populateFlairs();
      applyFilters();
      showSections();

      if (!afterCursor) {
        loadMoreBtn.disabled = true;
        loadMoreBtn.textContent = 'Keine weiteren Posts';
      } else {
        loadMoreBtn.disabled = false;
        loadMoreBtn.textContent = 'Mehr laden';
      }
    } catch (err) {
      setStatus('error', `Fehler: ${err.message}`);
    } finally {
      fetchBtn.disabled = false;
    }
  }

  function setStatus(type, msg) {
    fetchStatus.textContent = msg;
    fetchStatus.className = 'status' + (type ? ` ${type}` : '');
  }

  function showSections() {
    filterSection.classList.remove('hidden');
    postsSection.classList.remove('hidden');
    drawSection.classList.remove('hidden');
  }

  // ---- Flairs ----
  function populateFlairs() {
    const flairs = new Set();
    allPosts.forEach((p) => {
      if (p.flair) flairs.add(p.flair);
    });

    const prev = flairSelect.value;
    flairSelect.innerHTML = '<option value="">Alle Flairs</option>';
    [...flairs].sort().forEach((f) => {
      const opt = document.createElement('option');
      opt.value = f;
      opt.textContent = f;
      flairSelect.appendChild(opt);
    });
    flairSelect.value = prev || '';
  }

  // ---- Filters ----
  function applyFilters() {
    const flair = flairSelect.value;
    const from = dateFrom.value ? new Date(dateFrom.value).getTime() / 1000 : null;
    const to = dateTo.value ? new Date(dateTo.value + 'T23:59:59').getTime() / 1000 : null;
    const minScore = scoreMin.value !== '' ? Number(scoreMin.value) : null;
    const maxScore = scoreMax.value !== '' ? Number(scoreMax.value) : null;

    filteredPosts = allPosts.filter((p) => {
      if (flair && p.flair !== flair) return false;
      if (from && p.created < from) return false;
      if (to && p.created > to) return false;
      if (minScore !== null && p.score < minScore) return false;
      if (maxScore !== null && p.score > maxScore) return false;
      return true;
    });

    // Update filter summary
    const parts = [];
    if (flair) parts.push(`Flair: "${flair}"`);
    if (dateFrom.value) parts.push(`Von: ${dateFrom.value}`);
    if (dateTo.value) parts.push(`Bis: ${dateTo.value}`);
    if (minScore !== null) parts.push(`Upvotes \u2265 ${minScore}`);
    if (maxScore !== null) parts.push(`Upvotes \u2264 ${maxScore}`);
    filterSummary.textContent = parts.length
      ? `Filter aktiv: ${parts.join(', ')} — ${filteredPosts.length} Posts`
      : `${filteredPosts.length} Posts (kein Filter)`;

    // Keep only valid selections
    const validIds = new Set(filteredPosts.map((p) => p.id));
    selectedIds = new Set([...selectedIds].filter((id) => validIds.has(id)));

    renderPosts();
    updateSelectedCount();
  }

  // ---- Rendering ----
  function renderPosts() {
    postList.innerHTML = '';

    if (filteredPosts.length === 0) {
      postList.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-muted)">Keine Posts gefunden</div>';
      return;
    }

    filteredPosts.forEach((post) => {
      const div = document.createElement('div');
      div.className = 'post-item' + (selectedIds.has(post.id) ? ' selected' : '');
      div.dataset.id = post.id;

      const date = new Date(post.created * 1000);
      const dateStr = date.toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });

      div.innerHTML = `
        <input type="checkbox" ${selectedIds.has(post.id) ? 'checked' : ''}>
        <div class="post-info">
          <div class="post-title"><a href="${escapeHtml(post.url)}" target="_blank" rel="noopener">${escapeHtml(post.title)}</a></div>
          <div class="post-meta">
            <span>u/${escapeHtml(post.author)}</span>
            <span>${dateStr}</span>
            <span>${post.score} Punkte</span>
            <span>${post.numComments} Kommentare</span>
            ${post.flair ? `<span class="post-flair">${escapeHtml(post.flair)}</span>` : ''}
          </div>
        </div>
      `;

      // Click anywhere on row to toggle
      div.addEventListener('click', (e) => {
        if (e.target.tagName === 'A') return;
        togglePost(post.id, div);
      });

      postList.appendChild(div);
    });
  }

  function togglePost(id, el) {
    if (selectedIds.has(id)) {
      selectedIds.delete(id);
      el.classList.remove('selected');
      el.querySelector('input').checked = false;
    } else {
      selectedIds.add(id);
      el.classList.add('selected');
      el.querySelector('input').checked = true;
    }
    updateSelectedCount();
  }

  function updateSelectedCount() {
    selectedCount.textContent = `${selectedIds.size} von ${filteredPosts.length} Posts ausgewählt`;
  }

  // ---- Select / Deselect ----
  function selectAll() {
    selectedIds = new Set(filteredPosts.map((p) => p.id));
    renderPosts();
    updateSelectedCount();
  }

  function deselectAll() {
    selectedIds.clear();
    renderPosts();
    updateSelectedCount();
  }

  // ---- Mode switching ----
  function setMode(mode) {
    drawMode = mode;
    modeBtns.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    rankingCriteriaGroup.classList.toggle('hidden', mode !== 'ranking');
    syncVerifiableControls();
    drawBtn.textContent = mode === 'random' ? 'Gewinner ziehen!' : 'Ranking erstellen!';
    updateVerificationUi();
  }

  function syncVerifiableControls() {
    const verifiableAvailable = drawMode === 'random';
    verifiableDrawCheckbox.disabled = !verifiableAvailable;

    if (!verifiableAvailable) {
      verifiableDrawCheckbox.checked = false;
      entropyGroup.classList.add('hidden');
      return;
    }

    entropyGroup.classList.toggle('hidden', !verifiableDrawCheckbox.checked);
  }

  function setUiStatus(el, type, msg) {
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'status' + (type ? ` ${type}` : '');
  }

  function parseManualExcludes() {
    return excludeUsersInput.value
      .split(',')
      .map((u) => u.trim().replace(/^u\//, ''))
      .filter(Boolean);
  }

  function buildDrawParams(count, uniqueUsers, manualExcludes) {
    return {
      winnerCount: count,
      uniqueUsers,
      sort: sortSelect.value,
      flair: flairSelect.value || null,
      dateFrom: dateFrom.value || null,
      dateTo: dateTo.value || null,
      minScore: scoreMin.value !== '' ? Number(scoreMin.value) : null,
      maxScore: scoreMax.value !== '' ? Number(scoreMax.value) : null,
      selectedPostIds: [...selectedIds].sort(),
      exclusions: {
        deleted: excludeDeletedCheckbox.checked,
        automoderator: excludeAutomodCheckbox.checked,
        moderators: excludeModsCheckbox.checked,
        manualUsers: [...manualExcludes].sort(),
      },
      rankingCriteria: drawMode === 'ranking' ? rankingCriteria.value : null,
      externalEntropy: externalEntropyInput.value.trim() || null,
    };
  }

  function getDrawContext() {
    const count = Math.max(1, parseInt(winnerCountInput.value, 10) || 1);
    const uniqueUsers = uniqueUsersCheckbox.checked;

    let pool = filteredPosts.filter((p) => selectedIds.has(p.id));
    if (pool.length === 0) {
      throw new Error('Bitte waehle mindestens einen Post aus.');
    }

    const excludedUsers = new Set();
    if (excludeDeletedCheckbox.checked) {
      excludedUsers.add('[deleted]');
      excludedUsers.add('[removed]');
    }
    if (excludeAutomodCheckbox.checked) {
      excludedUsers.add('AutoModerator');
    }
    if (excludeModsCheckbox.checked) {
      subredditMods.forEach((m) => excludedUsers.add(m));
    }

    const manualExcludes = parseManualExcludes();
    manualExcludes.forEach((u) => excludedUsers.add(u));

    if (excludedUsers.size > 0) {
      pool = pool.filter((p) => !excludedUsers.has(p.author));
    }

    if (pool.length === 0) {
      throw new Error('Nach Anwendung der Ausschluesse sind keine Posts uebrig.');
    }

    const drawParams = buildDrawParams(count, uniqueUsers, manualExcludes);
    return { pool, count, uniqueUsers, drawParams };
  }

  function canonicalizePost(post) {
    return {
      id: String(post.id),
      author: String(post.author),
      title: String(post.title),
      flair: post.flair || null,
      created: Number(post.created),
      score: Number(post.score),
      numComments: Number(post.numComments),
      url: String(post.url),
    };
  }

  function buildDrawSnapshot(pool, drawParams, mode) {
    const canonicalPool = pool
      .map((p) => canonicalizePost(p))
      .sort((a, b) => a.id.localeCompare(b.id));

    return {
      subreddit: subredditInput.value.trim(),
      mode,
      drawParams,
      pool: canonicalPool,
    };
  }

  function loadRunHistory() {
    try {
      const raw = localStorage.getItem(RUN_HISTORY_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((e) => e && typeof e === 'object' && typeof e.ts === 'number');
    } catch {
      return [];
    }
  }

  function saveRunHistory(entries) {
    try {
      localStorage.setItem(RUN_HISTORY_KEY, JSON.stringify(entries));
    } catch {
      // ignore storage failures (private mode/quota)
    }
  }

  function flairScope(flair) {
    return flair || '__all__';
  }

  function registerExecutionAndGetWeeklyStats(subreddit, flair) {
    const now = Date.now();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const cutoff = now - weekMs;
    const flairKey = flairScope(flair);

    const existing = loadRunHistory().filter((e) => e.ts >= cutoff);
    existing.push({
      ts: now,
      subreddit: subreddit || '',
      flair: flairKey,
    });
    saveRunHistory(existing);

    const count = existing.filter((e) =>
      e.subreddit === (subreddit || '') && e.flair === flairKey).length;

    return {
      subreddit: subreddit || '',
      flair: flairKey,
      flairLabel: flair || 'Alle',
      last7DaysCount: count,
      countedAt: new Date(now).toISOString(),
    };
  }

  function normalizeProofWinner(winner, index) {
    return {
      position: index + 1,
      user: winner.user,
      postId: winner.post.id,
      post: canonicalizePost(winner.post),
      rankValue: winner.rankValue || null,
    };
  }

  function getSnapshotFromProof(proof) {
    return {
      subreddit: proof.subreddit || '',
      mode: proof.mode,
      drawParams: proof.drawParams || {},
      pool: Array.isArray(proof.pool) ? proof.pool.map((p) => canonicalizePost(p)) : [],
    };
  }

  function normalizeIncomingProofWinners(winners) {
    if (!Array.isArray(winners)) return [];
    return winners.map((w, i) => ({
      position: i + 1,
      user: w.user,
      postId: w.postId || w.post?.id || null,
    }));
  }

  async function createDrawHash(snapshotHash, preCommit) {
    if (preCommit && preCommit.commitHash) {
      return sha256(`commit:${String(preCommit.commitHash).toLowerCase()}`);
    }
    return sha256(`snapshot:${String(snapshotHash).toLowerCase()}`);
  }

  async function buildProofPackage(snapshot, winners, options = {}) {
    const snapshotHash = options.snapshotHash || await sha256Object(snapshot);
    const poolHash = await sha256Object(snapshot.pool);
    const paramsHash = await sha256Object(snapshot.drawParams);
    const drawHash = options.drawHash || await createDrawHash(snapshotHash, options.preCommit || null);

    return {
      version: 'raffler-proof-v1',
      createdAt: new Date().toISOString(),
      subreddit: snapshot.subreddit,
      mode: snapshot.mode,
      drawParams: snapshot.drawParams,
      pool: snapshot.pool,
      poolHash,
      paramsHash,
      snapshotHash,
      drawHash,
      rng: snapshot.mode === 'random'
        ? {
          algorithm: 'sha256-sort-v1',
          derivation: 'sort by sha256(drawHash|scope|stableId)',
        }
        : {
          algorithm: 'ranking-sort-v1',
          derivation: 'sort by selected ranking criteria',
        },
      winners: winners.map((w, i) => normalizeProofWinner(w, i)),
      preCommit: options.preCommit
        ? {
          commitHash: options.preCommit.commitHash,
          nonce: options.preCommit.nonce,
          committedAt: options.preCommit.committedAt,
        }
        : null,
      control: options.weeklyStats
        ? {
          scope: 'subreddit+flair',
          subreddit: options.weeklyStats.subreddit,
          flair: options.weeklyStats.flair,
          flairLabel: options.weeklyStats.flairLabel,
          last7DaysCount: options.weeklyStats.last7DaysCount,
          countedAt: options.weeklyStats.countedAt,
        }
        : null,
    };
  }

  async function verifyProofPackage(proof) {
    const errors = [];
    const info = [];

    if (!proof || typeof proof !== 'object') {
      return { ok: false, errors: ['Ungueltiges JSON-Objekt.'], info: [] };
    }

    if (proof.version !== 'raffler-proof-v1') {
      errors.push(`Nicht unterstuetzte Version: ${proof.version || 'unbekannt'}`);
    }

    const snapshot = getSnapshotFromProof(proof);

    if (!['random', 'ranking'].includes(snapshot.mode)) {
      errors.push(`Unbekannter Modus: ${snapshot.mode || 'unbekannt'}`);
    }

    const computedPoolHash = await sha256Object(snapshot.pool);
    const computedParamsHash = await sha256Object(snapshot.drawParams);
    const computedSnapshotHash = await sha256Object(snapshot);

    if (!hashEquals(computedPoolHash, proof.poolHash)) {
      errors.push('Pool-Hash stimmt nicht mit dem Paketinhalt ueberein.');
    }
    if (!hashEquals(computedParamsHash, proof.paramsHash)) {
      errors.push('Parameter-Hash stimmt nicht mit dem Paketinhalt ueberein.');
    }
    if (proof.snapshotHash && !hashEquals(computedSnapshotHash, proof.snapshotHash)) {
      errors.push('Snapshot-Hash stimmt nicht mit dem Paketinhalt ueberein.');
    }

    if (proof.preCommit) {
      if (!proof.preCommit.nonce || !proof.preCommit.commitHash) {
        errors.push('Pre-Commit Daten sind unvollstaendig (nonce/commitHash fehlen).');
      } else {
        const expectedCommitHash = await sha256(`${computedSnapshotHash}|${proof.preCommit.nonce}`);
        if (!hashEquals(expectedCommitHash, proof.preCommit.commitHash)) {
          errors.push('Pre-Commit Hash ist ungueltig fuer Snapshot + nonce.');
        }
      }
    }

    const expectedDrawHash = await createDrawHash(computedSnapshotHash, proof.preCommit || null);
    if (!hashEquals(expectedDrawHash, proof.drawHash)) {
      errors.push('Draw-Hash ist inkonsistent.');
    }

    let expectedWinners = [];
    if (errors.length === 0) {
      if (snapshot.mode === 'random') {
        expectedWinners = await drawRandomVerifiable(snapshot, expectedDrawHash);
      } else {
        expectedWinners = runRankingFromSnapshot(snapshot);
      }

      const expectedNormalized = expectedWinners.map((w, i) => normalizeProofWinner(w, i));
      const winnerCompare = compareWinners(expectedNormalized, normalizeIncomingProofWinners(proof.winners));
      if (!winnerCompare.ok) {
        errors.push(winnerCompare.reason);
      }
    }

    if (errors.length === 0) {
      info.push('PASS: Pruefpaket ist konsistent und die Gewinner sind reproduzierbar.');
      info.push(`Draw-Hash: ${expectedDrawHash}`);
      info.push(`Gewinner: ${Array.isArray(proof.winners) ? proof.winners.length : 0}`);
    }

    return {
      ok: errors.length === 0,
      errors,
      info,
    };
  }

  function syncVerificationStateFromProof() {
    if (!currentProofPackage) {
      lastVerification = null;
      return;
    }

    lastVerification = {
      proofVersion: currentProofPackage.version,
      drawHash: currentProofPackage.drawHash,
      poolHash: currentProofPackage.poolHash,
      paramsHash: currentProofPackage.paramsHash,
      poolSize: currentProofPackage.pool.length,
      entropy: currentProofPackage.drawParams?.externalEntropy || null,
      commitHash: currentProofPackage.preCommit?.commitHash || null,
      weeklyRunsForFlair: currentProofPackage.control?.last7DaysCount ?? null,
      flairLabel: currentProofPackage.control?.flairLabel ?? null,
    };
  }

  function updateVerificationUi() {
    const hasWinners = currentWinners.length > 0;
    verificationSection.classList.toggle('hidden', !hasWinners);

    const hasProof = Boolean(currentProofPackage);
    verifyCurrentBtn.disabled = !hasProof;
    copyProofBtn.disabled = !hasProof;
    downloadProofBtn.disabled = !hasProof;

    const randomMode = drawMode === 'random';
    createPrecommitBtn.disabled = !randomMode;
    drawFromCommitBtn.disabled = !randomMode || !pendingPreCommit;
    if (!randomMode) {
      precommitDetails.open = false;
    }

    if (!hasProof) {
      setUiStatus(verifyStatus, '', 'Kein Pruefpaket aktiv. Nutze verifizierbare Ziehung oder Ranking fuer reproduzierbare Pruefung.');
    } else if (!verifyStatus.textContent || verifyStatus.textContent.startsWith('Kein Pruefpaket')) {
      setUiStatus(verifyStatus, '', 'Pruefpaket bereit. Du kannst jetzt pruefen, kopieren oder herunterladen.');
    }

    if (pendingPreCommit) {
      setUiStatus(precommitStatus, '', `Vorab-Commit aktiv:\n${pendingPreCommit.commitHash}`);
    } else if (!precommitStatus.textContent.startsWith('PASS')) {
      setUiStatus(precommitStatus, '', '');
    }
  }

  async function verifyCurrentProof() {
    if (!currentProofPackage) {
      setUiStatus(verifyStatus, 'error', 'Kein Pruefpaket vorhanden.');
      return;
    }

    const result = await verifyProofPackage(currentProofPackage);
    if (result.ok) {
      setUiStatus(verifyStatus, 'success', result.info.join('\n'));
    } else {
      setUiStatus(verifyStatus, 'error', `FAIL:\n- ${result.errors.join('\n- ')}`);
    }
  }

  async function verifyImportedProof() {
    const raw = proofImportInput.value.trim();
    if (!raw) {
      setUiStatus(verifyImportStatus, 'error', 'Bitte zuerst JSON einfuegen.');
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      setUiStatus(verifyImportStatus, 'error', 'JSON konnte nicht geparst werden.');
      return;
    }

    const result = await verifyProofPackage(parsed);
    if (result.ok) {
      setUiStatus(verifyImportStatus, 'success', result.info.join('\n'));
    } else {
      setUiStatus(verifyImportStatus, 'error', `FAIL:\n- ${result.errors.join('\n- ')}`);
    }
  }

  async function copyProofPackage() {
    if (!currentProofPackage) {
      setUiStatus(verifyStatus, 'error', 'Kein Pruefpaket zum Kopieren vorhanden.');
      return;
    }

    try {
      await navigator.clipboard.writeText(JSON.stringify(currentProofPackage, null, 2));
      setUiStatus(verifyStatus, 'success', 'Pruefpaket wurde in die Zwischenablage kopiert.');
    } catch {
      setUiStatus(verifyStatus, 'error', 'Kopieren fehlgeschlagen.');
    }
  }

  function downloadProofPackage() {
    if (!currentProofPackage) {
      setUiStatus(verifyStatus, 'error', 'Kein Pruefpaket zum Download vorhanden.');
      return;
    }

    const payload = JSON.stringify(currentProofPackage, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `raffler-proof-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setUiStatus(verifyStatus, 'success', 'Pruefpaket wurde heruntergeladen.');
  }

  async function createPreCommit() {
    try {
      if (drawMode !== 'random') {
        throw new Error('Vorab-Commit ist nur im Zufallsmodus verfuegbar.');
      }

      const drawContext = getDrawContext();
      const snapshot = buildDrawSnapshot(drawContext.pool, drawContext.drawParams, 'random');
      const snapshotHash = await sha256Object(snapshot);
      const nonce = randomHex(16);
      const commitHash = await sha256(`${snapshotHash}|${nonce}`);

      pendingPreCommit = {
        commitHash,
        nonce,
        committedAt: new Date().toISOString(),
        snapshotHash,
      };

      precommitDetails.open = true;
      setUiStatus(precommitStatus, 'success', `PASS: Vorab-Commit erzeugt.\nCommit-Hash:\n${commitHash}`);
      updateVerificationUi();
    } catch (err) {
      setUiStatus(precommitStatus, 'error', `Fehler: ${err.message}`);
    }
  }

  function randomHex(byteLength = 16) {
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // ---- Drawing / Ranking ----
  async function drawWinners(options = {}) {
    try {
      const drawContext = getDrawContext();
      let winners = [];
      currentProofPackage = null;

      if (drawMode === 'ranking') {
        const snapshot = buildDrawSnapshot(drawContext.pool, drawContext.drawParams, 'ranking');
        winners = buildRanking(
          drawContext.pool,
          drawContext.count,
          drawContext.uniqueUsers,
          drawContext.drawParams.rankingCriteria
        );
        const weeklyStats = registerExecutionAndGetWeeklyStats(snapshot.subreddit, drawContext.drawParams.flair);
        currentProofPackage = await buildProofPackage(snapshot, winners, { weeklyStats });
      } else if (options.usePreCommit) {
        if (!pendingPreCommit) {
          throw new Error('Kein Vorab-Commit vorhanden.');
        }

        const snapshot = buildDrawSnapshot(drawContext.pool, drawContext.drawParams, 'random');
        const snapshotHash = await sha256Object(snapshot);
        if (!hashEquals(snapshotHash, pendingPreCommit.snapshotHash)) {
          throw new Error('Aktueller Snapshot passt nicht zum Vorab-Commit. Bitte neuen Commit erzeugen.');
        }

        const drawHash = await createDrawHash(snapshotHash, pendingPreCommit);
        winners = await drawRandomVerifiable(snapshot, drawHash);
        const weeklyStats = registerExecutionAndGetWeeklyStats(snapshot.subreddit, drawContext.drawParams.flair);
        currentProofPackage = await buildProofPackage(snapshot, winners, {
          preCommit: pendingPreCommit,
          snapshotHash,
          drawHash,
          weeklyStats,
        });
      } else if (verifiableDrawCheckbox.checked) {
        const snapshot = buildDrawSnapshot(drawContext.pool, drawContext.drawParams, 'random');
        const snapshotHash = await sha256Object(snapshot);
        const drawHash = await createDrawHash(snapshotHash, null);
        winners = await drawRandomVerifiable(snapshot, drawHash);
        const weeklyStats = registerExecutionAndGetWeeklyStats(snapshot.subreddit, drawContext.drawParams.flair);
        currentProofPackage = await buildProofPackage(snapshot, winners, {
          snapshotHash,
          drawHash,
          weeklyStats,
        });
      } else {
        registerExecutionAndGetWeeklyStats(subredditInput.value.trim(), drawContext.drawParams.flair);
        lastVerification = null;
        winners = drawRandom(drawContext.pool, drawContext.count, drawContext.uniqueUsers);
      }

      syncVerificationStateFromProof();
      displayWinners(winners);
      if (currentProofPackage) {
        setUiStatus(verifyStatus, '', 'Pruefpaket bereit. Du kannst jetzt pruefen, kopieren oder herunterladen.');
      } else {
        setUiStatus(verifyStatus, '', 'Kein Pruefpaket aktiv. Nutze verifizierbare Ziehung oder Ranking fuer reproduzierbare Pruefung.');
      }
      setUiStatus(verifyImportStatus, '', '');
      updateVerificationUi();
    } catch (err) {
      console.error('Draw error:', err.message);
      alert(`Fehler bei der Ziehung: ${err.message}`);
    }
  }

  function drawRandom(pool, count, uniqueUsers) {
    if (uniqueUsers) {
      const byUser = {};
      pool.forEach((p) => {
        if (!byUser[p.author]) byUser[p.author] = [];
        byUser[p.author].push(p);
      });

      const userEntries = Object.entries(byUser).map(([user, posts]) => ({
        user,
        post: posts[Math.floor(Math.random() * posts.length)],
      }));

      shuffleArray(userEntries);
      return userEntries.slice(0, Math.min(count, userEntries.length));
    }

    const shuffled = [...pool];
    shuffleArray(shuffled);
    return shuffled.slice(0, Math.min(count, shuffled.length)).map((p) => ({
      user: p.author,
      post: p,
    }));
  }

  async function drawRandomVerifiable(snapshot, drawHash) {
    const sortedPool = [...snapshot.pool].sort((a, b) => a.id.localeCompare(b.id));
    const count = Math.max(1, Number(snapshot.drawParams.winnerCount) || 1);
    const uniqueUsers = Boolean(snapshot.drawParams.uniqueUsers);

    if (uniqueUsers) {
      const byUser = {};
      sortedPool.forEach((p) => {
        if (!byUser[p.author]) byUser[p.author] = [];
        byUser[p.author].push(p);
      });

      const users = Object.keys(byUser).sort();
      const userEntries = [];
      for (const user of users) {
        const posts = byUser[user];
        const orderedPosts = await deterministicSortByHash(posts, (p) => p.id, `${drawHash}|user-post|${user}`);
        userEntries.push({ user, post: orderedPosts[0] });
      }

      const orderedUsers = await deterministicSortByHash(
        userEntries,
        (entry) => `${entry.user}|${entry.post.id}`,
        `${drawHash}|user-order`
      );

      return orderedUsers.slice(0, Math.min(count, orderedUsers.length)).map((entry) => ({
        user: entry.user,
        post: entry.post,
      }));
    }

    const orderedPosts = await deterministicSortByHash(sortedPool, (p) => p.id, `${drawHash}|post-order`);
    return orderedPosts.slice(0, Math.min(count, orderedPosts.length)).map((post) => ({
      user: post.author,
      post,
    }));
  }

  async function deterministicSortByHash(items, getStableId, scope) {
    const withHash = await Promise.all(items.map(async (item) => {
      const stableId = String(getStableId(item));
      const hash = await sha256(`${scope}|${stableId}`);
      return { item, stableId, hash };
    }));

    withHash.sort((a, b) => a.hash.localeCompare(b.hash) || a.stableId.localeCompare(b.stableId));
    return withHash.map((x) => x.item);
  }

  function getRankingSortFn(criteria) {
    return {
      score: (a, b) => b.score - a.score,
      numComments: (a, b) => b.numComments - a.numComments,
      'created-asc': (a, b) => a.created - b.created,
      'created-desc': (a, b) => b.created - a.created,
    }[criteria] || ((a, b) => b.score - a.score);
  }

  function buildRanking(pool, count, uniqueUsers, criteria = rankingCriteria.value) {
    const sortFn = getRankingSortFn(criteria);

    if (uniqueUsers) {
      const byUser = {};
      pool.forEach((p) => {
        if (!byUser[p.author]) {
          byUser[p.author] = p;
        } else if (sortFn(p, byUser[p.author]) < 0) {
          byUser[p.author] = p;
        }
      });
      pool = Object.values(byUser);
    }

    const sorted = [...pool].sort(sortFn);
    return sorted.slice(0, Math.min(count, sorted.length)).map((p) => ({
      user: p.author,
      post: p,
      rankValue: formatRankValue(p, criteria),
    }));
  }

  function runRankingFromSnapshot(snapshot) {
    const count = Math.max(1, Number(snapshot.drawParams.winnerCount) || 1);
    const uniqueUsers = Boolean(snapshot.drawParams.uniqueUsers);
    const criteria = snapshot.drawParams.rankingCriteria || 'score';
    return buildRanking(snapshot.pool, count, uniqueUsers, criteria);
  }

  function formatRankValue(post, criteria) {
    switch (criteria) {
      case 'score': return `${post.score} Punkte`;
      case 'numComments': return `${post.numComments} Kommentare`;
      case 'created-asc':
      case 'created-desc':
        return new Date(post.created * 1000).toLocaleDateString('de-DE', {
          day: '2-digit', month: '2-digit', year: 'numeric',
        });
      default: return '';
    }
  }

  function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  function displayWinners(winners) {
    currentWinners = winners;

    winnersSection.classList.remove('hidden');
    winnersList.innerHTML = '';

    const heading = winnersSection.querySelector('h2');
    heading.textContent = drawMode === 'ranking' ? 'Ranking' : 'Gewinner';

    winners.forEach((w, i) => {
      const card = document.createElement('div');
      card.className = 'winner-card';
      card.innerHTML = `
        <div class="winner-rank">#${i + 1}${w.rankValue ? `<span class="rank-value">${escapeHtml(w.rankValue)}</span>` : ''}</div>
        <div class="winner-user">
          <a href="https://www.reddit.com/user/${encodeURIComponent(w.user)}" target="_blank" rel="noopener">u/${escapeHtml(w.user)}</a>
        </div>
        <div class="winner-post">
          Post: <a href="${escapeHtml(w.post.url)}" target="_blank" rel="noopener">${escapeHtml(w.post.title)}</a>
        </div>
      `;
      winnersList.appendChild(card);
    });

    verificationSection.classList.remove('hidden');
    postGenSection.classList.remove('hidden');
    generatedPostWrapper.classList.add('hidden');
    buildPrizeFields();

    winnersSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ---- Post Generator ----
  function buildPrizeFields() {
    prizesList.innerHTML = '';
    currentWinners.forEach((w, i) => {
      const row = document.createElement('div');
      row.className = 'prize-row';
      row.innerHTML = `
        <span class="prize-label">#${i + 1} u/${escapeHtml(w.user)}</span>
        <input type="text" class="prize-input" placeholder="Gewinn eingeben..." data-index="${i}">
      `;
      prizesList.appendChild(row);
    });
  }

  function togglePrizes() {
    prizesList.classList.toggle('hidden', !prizesToggle.checked);
  }

  function generatePost() {
    const title = postTitleInput.value.trim();
    const intro = postIntroInput.value.trim();
    const outro = postOutroInput.value.trim();
    const showPrizes = prizesToggle.checked;
    const isRanking = drawMode === 'ranking';

    const lines = [];

    if (title) {
      lines.push(`# ${title}`);
      lines.push('');
    }

    if (intro) {
      lines.push(intro);
      lines.push('');
    }

    const label = isRanking ? 'Ranking' : 'Gewinner';
    lines.push(`## ${label}`);
    lines.push('');

    currentWinners.forEach((w, i) => {
      const prizeInput = showPrizes
        ? prizesList.querySelector(`.prize-input[data-index="${i}"]`)
        : null;
      const prize = prizeInput?.value.trim();

      let line = `**#${i + 1}** - u/${w.user}`;
      if (w.rankValue) {
        line += ` (${w.rankValue})`;
      }
      if (prize) {
        line += ` - ${prize}`;
      } else if (showPrizes) {
        line += ' - *[Gewinn]*';
      }
      lines.push(line);
    });

    lines.push('');

    if (outro) {
      lines.push(outro);
      lines.push('');
    }

    lines.push('---');
    lines.push('');
    lines.push('*Verwendete Kriterien:*');
    lines.push('');
    lines.push(`- **Modus:** ${isRanking ? 'Ranking' : 'Zufaellige Ziehung'}`);
    if (!isRanking) {
      lines.push(`- **Verifizierbare Ziehung:** ${lastVerification ? 'Ja' : 'Nein'}`);
    }
    if (isRanking) {
      const criteriaLabels = {
        score: 'Score (Upvotes)',
        numComments: 'Anzahl Kommentare',
        'created-asc': 'Datum (aelteste zuerst)',
        'created-desc': 'Datum (neueste zuerst)',
      };
      lines.push(`- **Ranking nach:** ${criteriaLabels[rankingCriteria.value]}`);
    }

    const flair = flairSelect.value;
    lines.push(`- **Flair:** ${flair || 'Alle'}`);
    if (dateFrom.value || dateTo.value) {
      const range = [dateFrom.value || '-', dateTo.value || '-'].join(' bis ');
      lines.push(`- **Zeitraum:** ${range}`);
    }
    lines.push(`- **Anzahl Posts:** ${selectedIds.size}`);

    if (uniqueUsersCheckbox.checked) {
      lines.push('- **Duplikate:** Zusammengefasst (ein Eintrag pro User)');
    }
    if (excludeDeletedCheckbox.checked) {
      lines.push('- **[deleted] User:** Ausgeschlossen');
    }
    if (excludeAutomodCheckbox.checked) {
      lines.push('- **AutoModerator:** Ausgeschlossen');
    }
    if (excludeModsCheckbox.checked && subredditMods.length > 0) {
      lines.push(`- **Moderatoren:** Ausgeschlossen (${subredditMods.length} Mods)`);
    }

    const manualExcludesPost = parseManualExcludes();
    if (manualExcludesPost.length > 0) {
      lines.push(`- **Ausgeschlossene User:** ${manualExcludesPost.map((u) => 'u/' + u).join(', ')}`);
    }

    if (lastVerification) {
      lines.push(`- **Proof-Format:** ${lastVerification.proofVersion}`);
      lines.push(`- **Draw-Hash:** \`${lastVerification.drawHash}\``);
      lines.push(`- **Pool-Hash:** \`${lastVerification.poolHash}\``);
      lines.push(`- **Parameter-Hash:** \`${lastVerification.paramsHash}\``);
      lines.push(`- **Poolgroesse (nach Filtern):** ${lastVerification.poolSize}`);
      if (lastVerification.entropy) {
        lines.push(`- **Externer Zufallswert:** \`${lastVerification.entropy}\``);
      }
      if (lastVerification.commitHash) {
        lines.push(`- **Vorab-Commit:** \`${lastVerification.commitHash}\``);
      }
      if (lastVerification.weeklyRunsForFlair !== null) {
        lines.push(`- **Raffler-Ausfuehrungen (letzte 7 Tage, Flair "${lastVerification.flairLabel || 'Alle'}"):** ${lastVerification.weeklyRunsForFlair}`);
      }
      lines.push('- **Pruefpaket:** Kann in der Verifikationssektion exportiert werden.');
    }

    lines.push('');

    const output = lines.join('\n');
    generatedPostOutput.textContent = output;
    generatedPostWrapper.classList.remove('hidden');
    copyFeedback.textContent = '';
  }

  async function copyPost() {
    const text = generatedPostOutput.textContent;
    try {
      await navigator.clipboard.writeText(text);
      copyFeedback.textContent = 'Kopiert!';
    } catch {
      const range = document.createRange();
      range.selectNodeContents(generatedPostOutput);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      copyFeedback.textContent = 'Text markiert - bitte manuell kopieren';
    }
    setTimeout(() => { copyFeedback.textContent = ''; }, 3000);
  }

  // ---- Utilities ----
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function stableStringify(value) {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
      return `[${value.map((v) => stableStringify(v)).join(',')}]`;
    }

    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }

  async function sha256(message) {
    const buf = new TextEncoder().encode(message);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function sha256Object(obj) {
    return sha256(stableStringify(obj));
  }

  function hashEquals(a, b) {
    return String(a || '').toLowerCase() === String(b || '').toLowerCase();
  }

  function compareWinners(expected, actualProofWinners) {
    if (expected.length !== actualProofWinners.length) {
      return {
        ok: false,
        reason: `Gewinneranzahl weicht ab (erwartet ${expected.length}, erhalten ${actualProofWinners.length}).`,
      };
    }

    for (let i = 0; i < expected.length; i++) {
      const exp = expected[i];
      const got = actualProofWinners[i];
      if (!got) {
        return { ok: false, reason: `Gewinner #${i + 1} fehlt im Paket.` };
      }

      if (String(exp.user) !== String(got.user) || String(exp.postId) !== String(got.postId)) {
        return {
          ok: false,
          reason: `Gewinner #${i + 1} stimmt nicht (erwartet u/${exp.user} (${exp.postId}), erhalten u/${got.user} (${got.postId})).`,
        };
      }
    }

    return { ok: true };
  }

  // ---- Events ----
  fetchBtn.addEventListener('click', () => loadPosts(false));
  subredditInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadPosts(false);
  });
  loadMoreBtn.addEventListener('click', () => loadPosts(true));
  applyFiltersBtn.addEventListener('click', applyFilters);
  selectAllBtn.addEventListener('click', selectAll);
  deselectAllBtn.addEventListener('click', deselectAll);
  modeBtns.forEach((btn) => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });
  verifiableDrawCheckbox.addEventListener('change', syncVerifiableControls);
  drawBtn.addEventListener('click', () => drawWinners());
  verifyCurrentBtn.addEventListener('click', verifyCurrentProof);
  copyProofBtn.addEventListener('click', copyProofPackage);
  downloadProofBtn.addEventListener('click', downloadProofPackage);
  createPrecommitBtn.addEventListener('click', createPreCommit);
  drawFromCommitBtn.addEventListener('click', () => drawWinners({ usePreCommit: true }));
  verifyImportBtn.addEventListener('click', verifyImportedProof);
  prizesToggle.addEventListener('change', togglePrizes);
  generatePostBtn.addEventListener('click', generatePost);
  copyPostBtn.addEventListener('click', copyPost);

  syncVerifiableControls();
  updateVerificationUi();
})();
