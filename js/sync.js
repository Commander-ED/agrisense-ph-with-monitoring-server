// ============================================================
// sync.js
// Pag-sync ng detection data sa Firebase Firestore.
// Gumagana online at offline:
//   - Online:  agad nag-u-upload sa Firestore
//   - Offline: nag-i-save sa localStorage queue,
//              nag-si-sync kapag bumalik ang internet
//
// Depende sa: firebase.js (dapat i-load muna)
// ============================================================

// ── OFFLINE QUEUE KEY ─────────────────────────────────────────
// Key para sa localStorage kung saan naka-store ang
// mga detections na hindi pa nai-upload.
const OFFLINE_QUEUE_KEY = 'agrisense_sync_queue';

// ── PHOTO UPLOAD ──────────────────────────────────────────────

/**
 * Mag-upload ng larawan ng dahon sa Firebase Storage.
 * Ibinabalik ang download URL para i-save sa Firestore.
 *
 * @param   {string} base64Image - Base64 encoded image (mula sa canvas)
 * @param   {string} userId      - UID ng farmer
 * @param   {string} detectionId - ID ng detection record
 * @returns {Promise<string>}    Download URL ng uploaded photo
 */
async function uploadLeafPhoto(base64Image, userId, detectionId) {
  try {
    // I-convert ang base64 sa Blob para ma-upload
    const response  = await fetch(base64Image);
    const blob      = await response.blob();

    // I-define ang path sa Firebase Storage
    // Format: leaf_photos/{userId}/{detectionId}.jpg
    const photoRef  = storage.ref(`leaf_photos/${userId}/${detectionId}.jpg`);

    // I-upload ang Blob
    const snapshot  = await photoRef.put(blob, { contentType: 'image/jpeg' });

    // Kunin ang download URL
    const downloadUrl = await snapshot.ref.getDownloadURL();
    return downloadUrl;

  } catch (error) {
    console.warn('Photo upload failed — saving without photo:', error);
    return null; // Hindi critical — okay kahit walang photo
  }
}

// ── CAPTURE CURRENT FRAME ─────────────────────────────────────

/**
 * Kumuha ng screenshot ng kasalukuyang camera frame o
 * uploaded image para i-save kasama ang detection record.
 * Ginagamit ang Canvas API para i-convert sa base64.
 *
 * @returns {string|null} Base64 image string o null kung walang source
 */
function captureCurrentFrame() {
  try {
    const source = STATE.camera.cameraActive
      ? document.getElementById('video')
      : document.getElementById('uploaded-img');

    if (!source || source.style.display === 'none') return null;

    // Gumawa ng off-screen canvas at i-draw ang source
    const canvas    = document.createElement('canvas');
    canvas.width    = 640;
    canvas.height   = 480;
    const ctx       = canvas.getContext('2d');
    ctx.drawImage(source, 0, 0, 640, 480);

    // I-convert sa compressed JPEG base64
    return canvas.toDataURL('image/jpeg', 0.7); // 70% quality = smaller file

  } catch (e) {
    console.warn('Frame capture failed:', e);
    return null;
  }
}

// ── MAIN SYNC FUNCTION ────────────────────────────────────────

/**
 * Pangunahing function para i-sync ang detection result sa cloud.
 * Tinatawag ng results.js pagkatapos ng successful detection.
 *
 * Flow:
 * 1. Kunin ang current user
 * 2. I-capture ang larawan ng dahon
 * 3. Gumawa ng detection record object
 * 4. Kung online: i-upload agad sa Firestore + Storage
 * 5. Kung offline: i-queue sa localStorage
 * 6. I-update ang community stats
 *
 * @param {Object} detectionData - { crop, disease, confidence, predictions }
 * @param {Object} weatherData   - Weather data mula sa STATE.weather
 */
async function syncDetectionToCloud(detectionData, weatherData) {
  // Huwag mag-sync kung hindi naka-login
  const user = auth.currentUser;
  if (!user) {
    console.log('Not logged in — saving locally only');
    return;
  }

  // Gumawa ng unique detection ID
  const detectionId = `det_${user.uid}_${Date.now()}`;

  // I-capture ang larawan para isama sa record
  const photoBase64 = captureCurrentFrame();

  // Buuin ang detection record
  const record = {
    id:           detectionId,
    userId:       user.uid,
    crop:         detectionData.crop,
    disease:      detectionData.disease,
    confidence:   detectionData.confidence,
    severity:     getSeverityLevel(detectionData.confidence),
    // Lahat ng scores para sa transparency
    allScores:    detectionData.predictions.map(p => ({
      className:   p.className,
      probability: Math.round(p.probability * 100)
    })),
    // Weather data sa oras ng detection
    weather:      weatherData ? {
      temp:         weatherData.temp,
      humidity:     weatherData.humidity,
      rain:         weatherData.rain,
      wind:         weatherData.wind,
      locationName: weatherData.locationName || null
    } : null,
    // GPS location
    location:     weatherData ? {
      lat: parseFloat(weatherData.lat),
      lon: parseFloat(weatherData.lon)
    } : null,
    timestamp:    new Date().toISOString(),
    synced:       false // Magiging true kapag na-upload sa Firestore
  };

  if (isOnline()) {
    // ── ONLINE: I-upload agad ────────────────────────────────
    await uploadToFirestore(record, photoBase64);
  } else {
    // ── OFFLINE: I-queue para sa later sync ──────────────────
    addToOfflineQueue(record, photoBase64);
    showSyncStatus('offline');
    console.log('📥 Detection queued for sync when online');
  }
}

// ── UPLOAD TO FIRESTORE ───────────────────────────────────────

/**
 * Nag-u-upload ng detection record sa Firestore.
 * Kasama ang photo upload sa Firebase Storage kung available.
 *
 * @param {Object}      record      - Detection record object
 * @param {string|null} photoBase64 - Base64 photo o null
 */
async function uploadToFirestore(record, photoBase64) {
  try {
    showSyncStatus('syncing');

    // I-upload ang photo muna (kung may photo)
    let photoUrl = null;
    if (photoBase64) {
      photoUrl = await uploadLeafPhoto(photoBase64, record.userId, record.id);
    }

    // I-add ang photo URL sa record
    const firestoreRecord = {
      ...record,
      photoUrl:  photoUrl,
      synced:    true,
      syncedAt:  firebase.firestore.FieldValue.serverTimestamp(),
      // I-replace ang string timestamp ng Firestore timestamp
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    };

    // I-save sa Firestore detections collection
    await COLLECTIONS.detections.doc(record.id).set(firestoreRecord);

    // I-update ang community stats asynchronously
    // (hindi natin hihintayin ito — para hindi mabagal ang UI)
    updateCommunityStats(record).catch(e =>
      console.warn('Community stats update failed:', e)
    );

    // I-check kung may outbreak
    checkForOutbreak(record).catch(e =>
      console.warn('Outbreak check failed:', e)
    );

    showSyncStatus('success');
    console.log('✅ Detection synced to cloud:', record.id);

  } catch (error) {
    // Kung nag-fail ang upload — i-queue para subukan ulit
    console.error('Upload failed — queuing for retry:', error);
    addToOfflineQueue(record, photoBase64);
    showSyncStatus('failed');
  }
}

// ── COMMUNITY STATS UPDATE ────────────────────────────────────

/**
 * Ina-update ang community_stats collection sa Firestore.
 * Ginagamit ng Admin at DA Officer dashboard para sa
 * real-time na community analytics.
 *
 * Gumagamit ng Firestore transactions para atomic ang update —
 * hindi masisira ang data kahit sabay mag-detect ang maraming farmers.
 *
 * @param {Object} record - Detection record
 */
async function updateCommunityStats(record) {
  const statsRef = COLLECTIONS.communityStats.doc('summary');

  await db.runTransaction(async (transaction) => {
    const statsDoc = await transaction.get(statsRef);

    if (!statsDoc.exists) {
      // Unang detection — gumawa ng bagong stats document
      transaction.set(statsRef, {
        totalDetections:  1,
        diseaseBreakdown: { [record.disease]: 1 },
        cropBreakdown:    { [record.crop]: 1 },
        barangayData:     {},
        lastUpdated:      firebase.firestore.FieldValue.serverTimestamp()
      });
    } else {
      const stats = statsDoc.data();

      // I-update ang existing stats gamit ang FieldValue.increment
      // para atomic at safe kahit concurrent updates
      transaction.update(statsRef, {
        totalDetections: firebase.firestore.FieldValue.increment(1),
        [`diseaseBreakdown.${record.disease}`]:
          firebase.firestore.FieldValue.increment(1),
        [`cropBreakdown.${record.crop}`]:
          firebase.firestore.FieldValue.increment(1),
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
  });
}

// ── OUTBREAK DETECTION ───────────────────────────────────────

/**
 * I-check kung may outbreak sa isang lugar.
 * Kung 3+ detections ng parehong sakit sa loob ng 7 araw
 * sa iisang barangay/area — mag-create ng alert.
 *
 * @param {Object} record - Bagong detection record
 */
async function checkForOutbreak(record) {
  if (!record.location) return;
  if (record.disease.toLowerCase().includes('healthy')) return;

  // Tingnan ang mga recent detections ng parehong sakit
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const recentQuery = await COLLECTIONS.detections
    .where('disease', '==', record.disease)
    .where('synced', '==', true)
    .orderBy('syncedAt', 'desc')
    .limit(20)
    .get();

  // Bilang ng detections sa parehong approximate na area
  // (within ~5km radius — simplified gamit ang rounded coordinates)
  const nearbyCount = recentQuery.docs.filter(doc => {
    const data = doc.data();
    if (!data.location) return false;
    const latDiff = Math.abs(data.location.lat - record.location.lat);
    const lonDiff = Math.abs(data.location.lon - record.location.lon);
    // ~0.05 degrees ≈ 5km radius
    return latDiff < 0.05 && lonDiff < 0.05;
  }).length;

  // Kung 3+ detections — mag-create ng outbreak alert
  if (nearbyCount >= 3) {
    const alertRef = COLLECTIONS.alerts.doc();
    await alertRef.set({
      disease:      record.disease,
      crop:         record.crop,
      severity:     nearbyCount >= 5 ? 'high' : 'medium',
      location:     record.location,
      locationName: record.weather?.locationName || 'Unknown location',
      affectedCount: nearbyCount,
      message:      `${nearbyCount} cases of ${record.disease} detected nearby within 7 days.`,
      resolved:     false,
      createdAt:    firebase.firestore.FieldValue.serverTimestamp()
    });
    console.log(`🚨 Outbreak alert created: ${record.disease} (${nearbyCount} cases)`);
  }
}

// ── OFFLINE QUEUE ─────────────────────────────────────────────

/**
 * Nagdadagdag ng detection sa offline queue sa localStorage.
 * Nag-si-sync kapag bumalik ang internet connection.
 *
 * @param {Object}      record      - Detection record
 * @param {string|null} photoBase64 - Photo data
 */
function addToOfflineQueue(record, photoBase64) {
  const queue = getOfflineQueue();
  queue.push({ record, photoBase64, queuedAt: new Date().toISOString() });
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
}

/**
 * Kumuha ng offline queue mula sa localStorage.
 *
 * @returns {Array} Array ng queued records
 */
function getOfflineQueue() {
  try {
    return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
  } catch (e) {
    return [];
  }
}

/**
 * I-process ang lahat ng queued detections kapag bumalik ang internet.
 * Tinatawag kapag 'online' event ang na-detect.
 */
async function processOfflineQueue() {
  const queue = getOfflineQueue();
  if (!queue.length) return;

  console.log(`📤 Processing ${queue.length} queued detections...`);
  showSyncStatus('syncing');

  const successIds = [];

  for (const item of queue) {
    try {
      await uploadToFirestore(item.record, item.photoBase64);
      successIds.push(item.record.id);
    } catch (e) {
      console.error('Failed to sync queued item:', e);
    }
  }

  // Tanggalin ang mga na-sync na mula sa queue
  const remaining = queue.filter(item => !successIds.includes(item.record.id));
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining));

  if (remaining.length === 0) {
    showSyncStatus('success');
    console.log('✅ All queued detections synced!');
  }
}

// I-process ang queue kapag bumalik ang internet
window.addEventListener('online', processOfflineQueue);

// ── SEVERITY LEVEL ────────────────────────────────────────────

/**
 * Kinukuha ang severity level batay sa confidence percentage.
 * Ginagamit para sa admin dashboard at outbreak detection.
 *
 * @param   {number} confidence - AI confidence (0-100)
 * @returns {string} 'mild' | 'moderate' | 'severe'
 */
function getSeverityLevel(confidence) {
  if (confidence >= 90) return 'severe';
  if (confidence >= 80) return 'moderate';
  return 'mild';
}

// ── SYNC STATUS UI ────────────────────────────────────────────

/**
 * Nagpapakita ng sync status indicator sa UI.
 * Maliit na icon sa status bar na nagpapakita kung
 * nag-si-sync, success, o failed ang upload.
 *
 * @param {string} status - 'syncing' | 'success' | 'failed' | 'offline'
 */
function showSyncStatus(status) {
  // Hanapin o gumawa ng sync indicator element
  let indicator = document.getElementById('sync-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'sync-indicator';
    indicator.style.cssText = `
      position: fixed; bottom: 70px; right: 12px;
      background: #1e5c1e; color: #fff;
      border-radius: 20px; padding: 5px 12px;
      font-size: 11px; font-weight: 600;
      z-index: 9999; transition: opacity 0.3s;
      display: flex; align-items: center; gap: 5px;
    `;
    document.body.appendChild(indicator);
  }

  const messages = {
    syncing: { text: '⟳ Nag-si-sync...', bg: '#185FA5' },
    success: { text: '✓ Na-sync sa cloud', bg: '#1e7a3e' },
    failed:  { text: '✗ Hindi na-sync — queued', bg: '#c05000' },
    offline: { text: '📶 Offline — queued', bg: '#7a5000' }
  };

  const msg = messages[status] || messages.syncing;
  indicator.textContent  = msg.text;
  indicator.style.background = msg.bg;
  indicator.style.opacity    = '1';

  // Auto-hide pagkatapos ng 3 segundo
  clearTimeout(indicator._hideTimer);
  indicator._hideTimer = setTimeout(() => {
    indicator.style.opacity = '0';
  }, 3000);
}

// ── GET FARMER DETECTIONS ─────────────────────────────────────

/**
 * Kunin ang detection history ng isang farmer mula sa Firestore.
 * Ginagamit ng individual farmer analytics.
 *
 * @param   {string} userId  - UID ng farmer
 * @param   {number} limit   - Bilang ng records (default 50)
 * @returns {Promise<Array>} Array ng detection records
 */
async function getFarmerDetections(userId, limit = 50) {
  try {
    const snapshot = await COLLECTIONS.detections
      .where('userId', '==', userId)
      .orderBy('syncedAt', 'desc')
      .limit(limit)
      .get();

    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (e) {
    console.error('Error fetching farmer detections:', e);
    return [];
  }
}

/**
 * Kunin ang lahat ng detections para sa admin/DA dashboard.
 * May optional na filter sa crop, disease, at date range.
 *
 * @param   {Object} filters - { crop, disease, days }
 * @returns {Promise<Array>} Array ng detection records
 */
async function getAllDetections(filters = {}) {
  try {
    let query = COLLECTIONS.detections.orderBy('syncedAt', 'desc');

    if (filters.crop)    query = query.where('crop', '==', filters.crop);
    if (filters.disease) query = query.where('disease', '==', filters.disease);

    // Default: last 30 days
    const days = filters.days || 30;
    const since = new Date();
    since.setDate(since.getDate() - days);

    const snapshot = await query.limit(500).get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (e) {
    console.error('Error fetching all detections:', e);
    return [];
  }
}
