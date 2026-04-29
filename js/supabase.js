// ============================================================
// supabase.js
// Supabase connection at lahat ng database functions.
// Mas simple kaysa Firebase — URL at key lang ang kailangan.
// ============================================================

// ── CONFIG ────────────────────────────────────────────────────
const SUPABASE_URL = 'https://qyiqodoqvavrqfddaxbn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_T-usxsctS9q0qHvvw-_FJA_rxOtH1yN';

// ── INITIALIZE SUPABASE CLIENT ────────────────────────────────
// Ang supabase client ay ang connection natin sa database.
// Ginagamit ito ng lahat ng ibang functions dito.
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ── USER ROLES ────────────────────────────────────────────────
const USER_ROLES = {
  FARMER:     'farmer',
  ADMIN:      'admin',
  DA_OFFICER: 'da_officer'
};

// ── ACCESS CODES ──────────────────────────────────────────────
// Palitan ng iyong sariling secret codes bago i-deploy
const ACCESS_CODES = {
  admin:      'AGRI-ADMIN-2025',
  da_officer: 'DA-OFFICER-2025'
};

// ============================================================
// AUTH FUNCTIONS
// Login, register, at logout ng users
// ============================================================

/**
 * Mag-register ng bagong user
 * @param {string} email
 * @param {string} password
 * @param {string} name - Buong pangalan
 * @param {string} role - farmer, admin, da_officer
 * @param {string} barangay - Para sa farmers lang
 */
async function registerUser(email, password, name, role, barangay = null) {
  try {
    // Step 1: Gumawa ng auth account sa Supabase
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name, role, barangay } // I-store ang extra info sa auth metadata
      }
    });

    if (authError) throw authError;

    // Step 2: I-save ang user profile sa users table
    const { error: profileError } = await supabase
      .from('users')
      .insert({
        id:        authData.user.id,
        name:      name,
        email:     email,
        role:      role,
        barangay:  barangay,
        active:    true,
        created_at: new Date().toISOString()
      });

    if (profileError) throw profileError;

    return { success: true, user: authData.user };

  } catch (error) {
    console.error('Register error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Mag-login ng existing user
 * @param {string} email
 * @param {string} password
 */
async function loginUser(email, password) {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    // Kunin ang user profile para malaman ang role
    const profile = await getUserProfile(data.user.id);
    return { success: true, user: data.user, profile };

  } catch (error) {
    console.error('Login error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Mag-logout ng current user
 */
async function logoutUser() {
  const { error } = await supabase.auth.signOut();
  if (error) console.error('Logout error:', error);
  window.location.href = 'auth.html';
}

/**
 * Kunin ang kasalukuyang naka-login na user
 */
async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

/**
 * Kunin ang user profile mula sa users table
 * @param {string} userId
 */
async function getUserProfile(userId) {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) throw error;
    return data;

  } catch (error) {
    console.error('Get profile error:', error);
    return null;
  }
}

// ============================================================
// DETECTION FUNCTIONS
// I-save at kunin ang detection records
// ============================================================

/**
 * I-save ang detection result sa database
 * @param {Object} data - Detection data
 */
async function saveDetection(data) {
  try {
    const user = await getCurrentUser();
    if (!user) return { success: false, error: 'Not logged in' };

    const record = {
      user_id:       user.id,
      crop:          data.crop,
      disease:       data.disease,
      confidence:    data.confidence,
      severity:      getSeverityLevel(data.confidence),
      all_scores:    JSON.stringify(data.predictions || []),
      // Weather data
      temperature:   data.weather?.temp || null,
      humidity:      data.weather?.humidity || null,
      rain:          data.weather?.rain || null,
      wind:          data.weather?.wind || null,
      location_name: data.weather?.locationName || null,
      latitude:      data.weather?.lat ? parseFloat(data.weather.lat) : null,
      longitude:     data.weather?.lon ? parseFloat(data.weather.lon) : null,
      // Photo
      photo_url:     data.photoUrl || null,
      created_at:    new Date().toISOString()
    };

    const { data: saved, error } = await supabase
      .from('detections')
      .insert(record)
      .select()
      .single();

    if (error) throw error;

    // I-check kung may outbreak
    checkForOutbreak(data.disease, data.weather?.lat, data.weather?.lon);

    return { success: true, data: saved };

  } catch (error) {
    console.error('Save detection error:', error);
    // I-queue offline kung may error
    addToOfflineQueue(data);
    return { success: false, error: error.message };
  }
}

/**
 * Kunin ang detections ng isang farmer
 * @param {string} userId
 * @param {number} limit
 */
async function getFarmerDetections(userId, limit = 50) {
  try {
    const { data, error } = await supabase
      .from('detections')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];

  } catch (error) {
    console.error('Get detections error:', error);
    return [];
  }
}

/**
 * Kunin ang lahat ng detections (para sa admin/DA)
 * @param {Object} filters - { crop, disease, days }
 */
async function getAllDetections(filters = {}) {
  try {
    let query = supabase
      .from('detections')
      .select(`
        *,
        users (name, email, barangay, role)
      `)
      .order('created_at', { ascending: false });

    // I-apply ang filters
    if (filters.crop)    query = query.eq('crop', filters.crop);
    if (filters.disease) query = query.eq('disease', filters.disease);

    // Date filter — default last 30 days
    const days = filters.days || 30;
    const since = new Date();
    since.setDate(since.getDate() - days);
    query = query.gte('created_at', since.toISOString());

    const { data, error } = await query.limit(500);
    if (error) throw error;
    return data || [];

  } catch (error) {
    console.error('Get all detections error:', error);
    return [];
  }
}

/**
 * Kunin ang lahat ng farmers (para sa admin)
 */
async function getAllFarmers() {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('role', 'farmer')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];

  } catch (error) {
    console.error('Get farmers error:', error);
    return [];
  }
}

/**
 * Kunin ang lahat ng users (para sa admin)
 */
async function getAllUsers() {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];

  } catch (error) {
    console.error('Get users error:', error);
    return [];
  }
}

// ============================================================
// ALERTS FUNCTIONS
// Outbreak alerts para sa Admin at DA Officer
// ============================================================

/**
 * Kunin ang lahat ng active alerts
 */
async function getActiveAlerts() {
  try {
    const { data, error } = await supabase
      .from('alerts')
      .select('*')
      .eq('resolved', false)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];

  } catch (error) {
    console.error('Get alerts error:', error);
    return [];
  }
}

/**
 * I-resolve ang isang alert
 * @param {string} alertId
 */
async function resolveAlert(alertId) {
  try {
    const { error } = await supabase
      .from('alerts')
      .update({ resolved: true, resolved_at: new Date().toISOString() })
      .eq('id', alertId);

    if (error) throw error;
    return { success: true };

  } catch (error) {
    console.error('Resolve alert error:', error);
    return { success: false };
  }
}

/**
 * I-check kung may outbreak sa isang lugar
 * Kung 3+ detections ng parehong sakit sa loob ng 7 araw — gumawa ng alert
 */
async function checkForOutbreak(disease, lat, lon) {
  if (!disease || disease.toLowerCase().includes('healthy')) return;

  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Bilang ng recent detections ng parehong sakit
    const { data, error } = await supabase
      .from('detections')
      .select('id, latitude, longitude, location_name')
      .eq('disease', disease)
      .gte('created_at', sevenDaysAgo.toISOString());

    if (error || !data) return;

    // Bilang ng detections sa parehong area (within ~5km)
    let nearbyCount = data.length;
    if (lat && lon) {
      nearbyCount = data.filter(d => {
        if (!d.latitude || !d.longitude) return true;
        return Math.abs(d.latitude - lat) < 0.05 &&
               Math.abs(d.longitude - lon) < 0.05;
      }).length;
    }

    // Kung 3+ cases — gumawa ng alert
    if (nearbyCount >= 3) {
      // I-check kung may existing alert na para sa disease na ito
      const { data: existing } = await supabase
        .from('alerts')
        .select('id')
        .eq('disease', disease)
        .eq('resolved', false)
        .limit(1);

      if (!existing || existing.length === 0) {
        const locationName = data[0]?.location_name || 'Unknown location';
        await supabase.from('alerts').insert({
          disease:       disease,
          severity:      nearbyCount >= 5 ? 'high' : 'medium',
          location_name: locationName,
          latitude:      lat || null,
          longitude:     lon || null,
          affected_count: nearbyCount,
          message:       `${nearbyCount} cases of ${disease} detected within 7 days.`,
          resolved:      false,
          created_at:    new Date().toISOString()
        });
        console.log(`Alert created: ${disease} — ${nearbyCount} cases`);
      }
    }
  } catch (error) {
    console.error('Outbreak check error:', error);
  }
}

// ============================================================
// OFFLINE QUEUE
// Nagtatago ng detections habang offline
// ============================================================

const OFFLINE_KEY = 'agrisense_offline_queue';

function addToOfflineQueue(data) {
  const queue = getOfflineQueue();
  queue.push({ ...data, queuedAt: new Date().toISOString() });
  localStorage.setItem(OFFLINE_KEY, JSON.stringify(queue));
  console.log('Detection queued for later sync');
}

function getOfflineQueue() {
  try {
    return JSON.parse(localStorage.getItem(OFFLINE_KEY) || '[]');
  } catch { return []; }
}

async function processOfflineQueue() {
  const queue = getOfflineQueue();
  if (!queue.length) return;

  console.log(`Syncing ${queue.length} queued detections...`);
  const failed = [];

  for (const item of queue) {
    const result = await saveDetection(item);
    if (!result.success) failed.push(item);
  }

  localStorage.setItem(OFFLINE_KEY, JSON.stringify(failed));
  if (failed.length === 0) console.log('All queued detections synced!');
}

// I-sync kapag bumalik ang internet
window.addEventListener('online', processOfflineQueue);

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Severity level batay sa confidence
 */
function getSeverityLevel(confidence) {
  if (confidence >= 90) return 'severe';
  if (confidence >= 80) return 'moderate';
  return 'mild';
}

/**
 * I-format ang date string sa readable format
 */
function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric'
  }) + ' · ' + d.toLocaleTimeString('en-PH', {
    hour: '2-digit', minute: '2-digit'
  });
}

/**
 * Nagpapakita ng sync status sa UI
 */
function showSyncStatus(status) {
  let indicator = document.getElementById('sync-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'sync-indicator';
    indicator.style.cssText = `
      position:fixed;bottom:70px;right:12px;
      border-radius:20px;padding:5px 12px;
      font-size:11px;font-weight:600;
      z-index:9999;transition:opacity 0.3s;
      display:flex;align-items:center;gap:5px;color:#fff;
    `;
    document.body.appendChild(indicator);
  }

  const styles = {
    syncing: { text: 'Nag-si-sync...', bg: '#185FA5' },
    success: { text: 'Na-save sa cloud', bg: '#1e7a3e' },
    offline: { text: 'Offline — queued', bg: '#7a5000' },
    failed:  { text: 'Hindi na-sync', bg: '#c05000' }
  };

  const s = styles[status] || styles.syncing;
  indicator.textContent      = s.text;
  indicator.style.background = s.bg;
  indicator.style.opacity    = '1';

  clearTimeout(indicator._t);
  indicator._t = setTimeout(() => {
    indicator.style.opacity = '0';
  }, 3000);
}

/**
 * Check if online
 */
function isOnline() { return navigator.onLine; }
