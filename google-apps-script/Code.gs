const SHEETS = {
  STUDENTS: 'Students',
  ATTENDANCE: 'Attendance',
  CLASSES: 'Classes'
};

const SESSION_SECONDS = 8 * 60 * 60;

function doGet(e) {
  try {
    const action = (e.parameter.action || '').trim();
    const token = (e.parameter.token || '').trim();

    switch (action) {
      case 'bootstrap':
        requireSession_(token);
        return json_({
          success: true,
          students: getStudents_(),
          classes: getClasses_(),
          todayAttendance: getTodayAttendance_()
        });

      case 'students':
        requireSession_(token);
        return json_({ success: true, students: getStudents_() });

      case 'today':
        requireSession_(token);
        return json_({ success: true, attendance: getTodayAttendance_() });

      case 'session':
        return json_({ success: validateSession_(token) });

      default:
        return json_({ success: false, error: 'INVALID_ACTION' });
    }
  } catch (err) {
    return errorResponse_(err);
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    const action = body.action || '';

    switch (action) {
      case 'login':
        return login_(body.pin);

      case 'logout':
        return logout_(body.token);

      case 'checkin':
        requireSession_(body.token);
        return json_(checkIn_(body.student_id, body.class_id || 'C001'));

      case 'removeCheckIn':
      case 'removeCheckin':
        requireSession_(body.token);
        return json_(removeCheckIn_(body.student_id, body.class_id || 'C001'));

      default:
        return json_({ success: false, error: 'INVALID_ACTION' });
    }
  } catch (err) {
    return errorResponse_(err);
  }
}

function login_(pin) {
  if (!pin) return json_({ success: false, error: 'PIN_REQUIRED' });

  const savedHash = PropertiesService.getScriptProperties().getProperty('ADMIN_PIN_HASH');
  if (!savedHash) throw new Error('ADMIN_PIN_NOT_CONFIGURED');

  if (sha256_(String(pin)) !== savedHash) {
    Utilities.sleep(750);
    return json_({ success: false, error: 'INVALID_PIN' });
  }

  const token = Utilities.getUuid() + Utilities.getUuid();
  CacheService.getScriptCache().put('SESSION_' + token, 'valid', SESSION_SECONDS);

  return json_({ success: true, token, expires_in: SESSION_SECONDS });
}

function logout_(token) {
  if (token) CacheService.getScriptCache().remove('SESSION_' + token);
  return json_({ success: true });
}

function validateSession_(token) {
  return !!token && CacheService.getScriptCache().get('SESSION_' + token) === 'valid';
}

function requireSession_(token) {
  if (!validateSession_(token)) throw new Error('UNAUTHORIZED');
}

function getStudents_() {
  const sheet = getSheet_(SHEETS.STUDENTS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  return sheet.getRange(2, 1, lastRow - 1, 4).getValues()
    .filter(row => row[3] === true || String(row[3]).toUpperCase() === 'TRUE')
    .map(row => ({
      student_id: String(row[0]),
      name: String(row[1]),
      belt: String(row[2] || ''),
      active: true
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getClasses_() {
  const sheet = getSheet_(SHEETS.CLASSES);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  return sheet.getRange(2, 1, lastRow - 1, 3).getValues()
    .filter(row => row[2] === true || String(row[2]).toUpperCase() === 'TRUE')
    .map(row => ({
      class_id: String(row[0]),
      class_name: String(row[1]),
      active: true
    }));
}

function getTodayAttendance_() {
  const sheet = getSheet_(SHEETS.ATTENDANCE);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

  return sheet.getRange(2, 1, lastRow - 1, 7).getValues()
    .filter(row => normalizeDate_(row[2], tz) === today)
    .map(row => ({
      attendance_id: String(row[0]),
      timestamp: row[1],
      date: row[2],
      student_id: String(row[3]),
      student_name: String(row[4]),
      class_id: String(row[5]),
      class_name: String(row[6])
    }));
}

function checkIn_(studentId, classId) {
  if (!studentId) throw new Error('STUDENT_ID_REQUIRED');
  if (!classId) throw new Error('CLASS_ID_REQUIRED');

  const student = findStudent_(studentId);
  if (!student) throw new Error('STUDENT_NOT_FOUND');

  const classObj = findClass_(classId);
  if (!classObj) throw new Error('CLASS_NOT_FOUND');

  const existing = findTodayAttendance_(studentId, classId);
  if (existing) return { success: false, error: 'ALREADY_CHECKED_IN', attendance: existing };

  const sheet = getSheet_(SHEETS.ATTENDANCE);
  const now = new Date();
  const tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  const attendanceId =
    'ATT-' + Utilities.formatDate(now, tz, 'yyyyMMdd-HHmmss') + '-' + Utilities.getUuid().substring(0, 6);

  sheet.appendRow([
    attendanceId,
    now,
    now,
    student.student_id,
    student.name,
    classObj.class_id,
    classObj.class_name
  ]);

  return {
    success: true,
    attendance: {
      attendance_id: attendanceId,
      timestamp: now,
      date: now,
      student_id: student.student_id,
      student_name: student.name,
      class_id: classObj.class_id,
      class_name: classObj.class_name
    }
  };
}

function removeCheckIn_(studentId, classId) {
  const sheet = getSheet_(SHEETS.ATTENDANCE);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: false, error: 'ATTENDANCE_NOT_FOUND' };

  const tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const rows = sheet.getRange(2, 1, lastRow - 1, 7).getValues();

  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (
      String(row[3]) === String(studentId) &&
      String(row[5]) === String(classId) &&
      normalizeDate_(row[2], tz) === today
    ) {
      sheet.deleteRow(i + 2);
      return { success: true };
    }
  }

  return { success: false, error: 'ATTENDANCE_NOT_FOUND' };
}

function findStudent_(studentId) {
  return getStudents_().find(student => String(student.student_id) === String(studentId));
}

function findClass_(classId) {
  return getClasses_().find(c => String(c.class_id) === String(classId));
}

function findTodayAttendance_(studentId, classId) {
  return getTodayAttendance_().find(entry =>
    String(entry.student_id) === String(studentId) &&
    String(entry.class_id) === String(classId)
  );
}

function getSheet_(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error('SHEET_NOT_FOUND_' + name);
  return sheet;
}

function normalizeDate_(value, tz) {
  if (!value) return '';
  const date = Object.prototype.toString.call(value) === '[object Date]' ? value : new Date(value);
  if (isNaN(date.getTime())) return '';
  return Utilities.formatDate(date, tz, 'yyyy-MM-dd');
}

function sha256_(text) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    text,
    Utilities.Charset.UTF_8
  );

  return digest.map(byte => {
    const v = byte < 0 ? byte + 256 : byte;
    return ('0' + v.toString(16)).slice(-2);
  }).join('');
}

function json_(object) {
  return ContentService
    .createTextOutput(JSON.stringify(object))
    .setMimeType(ContentService.MimeType.JSON);
}

function errorResponse_(err) {
  return json_({
    success: false,
    error: err && err.message ? err.message : String(err)
  });
}