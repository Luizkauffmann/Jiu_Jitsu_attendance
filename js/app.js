(() => {
  const CONFIG = window.APP_CONFIG;
  const TOKEN_KEY = "jj_attendance_token";

  const state = {
    token: sessionStorage.getItem(TOKEN_KEY) || "",
    students: [],
    classes: [],
    attendance: [],
    query: "",
    busyStudentId: "",
    pendingRemoveStudent: null
  };

  const els = {
    loginView: document.getElementById("login-view"),
    appView: document.getElementById("app-view"),
    loginForm: document.getElementById("login-form"),
    pin: document.getElementById("pin"),
    loginBtn: document.getElementById("login-btn"),
    loginMessage: document.getElementById("login-message"),
    logoutBtn: document.getElementById("logout-btn"),
    refreshBtn: document.getElementById("refresh-btn"),
    search: document.getElementById("student-search"),
    studentList: document.getElementById("student-list"),
    empty: document.getElementById("empty-state"),
    presentCount: document.getElementById("present-count"),
    studentCount: document.getElementById("student-count"),
    todayLabel: document.getElementById("today-label"),
    connection: document.getElementById("connection-status"),
    toast: document.getElementById("toast"),
    removeDialog: document.getElementById("remove-dialog"),
    removeTitle: document.getElementById("remove-title"),
    confirmRemove: document.getElementById("confirm-remove-btn")
  };

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    els.todayLabel.textContent = new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric"
    }).format(new Date());

    bindEvents();

    if (state.token) {
      showApp();
      bootstrap();
    } else {
      showLogin();
    }
  }

  function bindEvents() {
    els.loginForm.addEventListener("submit", handleLogin);
    els.logoutBtn.addEventListener("click", logout);
    els.refreshBtn.addEventListener("click", bootstrap);
    els.search.addEventListener("input", (event) => {
      state.query = event.target.value.trim().toLowerCase();
      renderStudents();
    });

    els.removeDialog.addEventListener("close", async () => {
      if (els.removeDialog.returnValue === "confirm" && state.pendingRemoveStudent) {
        const student = state.pendingRemoveStudent;
        state.pendingRemoveStudent = null;
        await removeCheckIn(student);
      } else {
        state.pendingRemoveStudent = null;
      }
    });
  }

  async function handleLogin(event) {
    event.preventDefault();
    const pin = els.pin.value.trim();
    if (!pin) return;

    setLoginBusy(true);
    els.loginMessage.textContent = "";

    try {
      const data = await post({ action: "login", pin });
      if (!data.success || !data.token) {
        throw new Error(data.error === "INVALID_PIN" ? "Incorrect PIN." : (data.error || "Login failed."));
      }

      state.token = data.token;
      sessionStorage.setItem(TOKEN_KEY, state.token);
      els.pin.value = "";
      showApp();
      await bootstrap();
    } catch (error) {
      els.loginMessage.textContent = friendlyError(error);
    } finally {
      setLoginBusy(false);
    }
  }

  async function bootstrap() {
    if (!state.token) return showLogin();

    setConnection("loading", "Loading");
    els.refreshBtn.disabled = true;

    try {
      const data = await get("bootstrap", { token: state.token });
      if (!data.success) {
        if (data.error === "UNAUTHORIZED") return expireSession();
        throw new Error(data.error || "Could not load attendance.");
      }

      state.students = Array.isArray(data.students) ? data.students : [];
      state.classes = Array.isArray(data.classes) ? data.classes : [];
      state.attendance = Array.isArray(data.todayAttendance) ? data.todayAttendance : [];
      setConnection("online", "Connected");
      render();
    } catch (error) {
      if (String(error.message).includes("UNAUTHORIZED")) {
        return expireSession();
      }
      setConnection("offline", "Offline");
      showToast(friendlyError(error), true);
    } finally {
      els.refreshBtn.disabled = false;
    }
  }

  function render() {
    els.presentCount.textContent = state.attendance.length;
    els.studentCount.textContent = state.students.length;
    renderStudents();
  }

  function renderStudents() {
    const filtered = state.students.filter((student) =>
      String(student.name || "").toLowerCase().includes(state.query)
    );

    els.empty.classList.toggle("hidden", filtered.length > 0);

    els.studentList.innerHTML = filtered.map((student) => {
      const present = isPresent(student.student_id);
      const busy = state.busyStudentId === student.student_id;
      const belt = student.belt ? escapeHtml(student.belt) : "Student";

      return `
        <button
          type="button"
          class="student-row ${present ? "present" : ""}"
          data-student-id="${escapeAttr(student.student_id)}"
          ${busy ? "disabled" : ""}
          aria-pressed="${present ? "true" : "false"}"
        >
          <span class="check-circle">${present ? "✓" : "○"}</span>
          <span>
            <span class="student-name">${escapeHtml(student.name)}</span>
            <span class="student-meta">${belt}</span>
          </span>
          <span class="row-action">${busy ? "Saving..." : (present ? "Checked in" : "Check in")}</span>
        </button>
      `;
    }).join("");

    els.studentList.querySelectorAll(".student-row").forEach((button) => {
      button.addEventListener("click", () => {
        const student = state.students.find(s => s.student_id === button.dataset.studentId);
        if (!student) return;

        if (isPresent(student.student_id)) {
          state.pendingRemoveStudent = student;
          els.removeTitle.textContent = `Remove ${student.name}'s check-in?`;
          els.removeDialog.showModal();
        } else {
          checkIn(student);
        }
      });
    });
  }

  function isPresent(studentId) {
    return state.attendance.some((entry) =>
      String(entry.student_id) === String(studentId) &&
      String(entry.class_id) === String(CONFIG.DEFAULT_CLASS_ID)
    );
  }

  async function checkIn(student) {
    if (state.busyStudentId) return;
    state.busyStudentId = student.student_id;
    renderStudents();

    try {
      const data = await post({
        action: "checkin",
        token: state.token,
        student_id: student.student_id,
        class_id: CONFIG.DEFAULT_CLASS_ID
      });

      if (!data.success) {
        if (data.error === "UNAUTHORIZED") return expireSession();
        if (data.error === "ALREADY_CHECKED_IN") {
          await bootstrap();
          return;
        }
        throw new Error(data.error || "Check-in failed.");
      }

      if (data.attendance) state.attendance.push(data.attendance);
      render();
      showToast(`✓ ${student.name} checked in`);
      setConnection("online", "Connected");
    } catch (error) {
      setConnection("offline", "Connection issue");
      showToast(friendlyError(error), true);
    } finally {
      state.busyStudentId = "";
      renderStudents();
    }
  }

  async function removeCheckIn(student) {
    if (state.busyStudentId) return;
    state.busyStudentId = student.student_id;
    renderStudents();

    try {
      const data = await post({
        action: "removeCheckIn",
        token: state.token,
        student_id: student.student_id,
        class_id: CONFIG.DEFAULT_CLASS_ID
      });

      if (!data.success) {
        if (data.error === "UNAUTHORIZED") return expireSession();
        throw new Error(data.error || "Could not remove attendance.");
      }

      state.attendance = state.attendance.filter((entry) =>
        !(String(entry.student_id) === String(student.student_id) &&
          String(entry.class_id) === String(CONFIG.DEFAULT_CLASS_ID))
      );

      render();
      showToast(`Attendance removed for ${student.name}`);
      setConnection("online", "Connected");
    } catch (error) {
      showToast(friendlyError(error), true);
    } finally {
      state.busyStudentId = "";
      renderStudents();
    }
  }

  async function logout() {
    const token = state.token;
    clearSession();
    showLogin();

    if (token) {
      try {
        await post({ action: "logout", token });
      } catch (_) {
        // Local logout already succeeded.
      }
    }
  }

  function expireSession() {
    clearSession();
    showLogin();
    els.loginMessage.textContent = "Session expired. Enter the PIN again.";
  }

  function clearSession() {
    state.token = "";
    state.students = [];
    state.classes = [];
    state.attendance = [];
    state.query = "";
    sessionStorage.removeItem(TOKEN_KEY);
  }

  function showLogin() {
    els.appView.classList.add("hidden");
    els.loginView.classList.remove("hidden");
    setTimeout(() => els.pin.focus(), 30);
  }

  function showApp() {
    els.loginView.classList.add("hidden");
    els.appView.classList.remove("hidden");
  }

  function setLoginBusy(busy) {
    els.loginBtn.disabled = busy;
    els.pin.disabled = busy;
    els.loginBtn.textContent = busy ? "Logging in..." : "Log in";
  }

  function setConnection(mode, label) {
    els.connection.textContent = label;
    els.connection.className = "status-dot";
    if (mode === "offline") els.connection.classList.add("offline");
    if (mode === "loading") els.connection.classList.add("loading");
  }

  let toastTimer;
  function showToast(message, isError = false) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.remove("hidden", "error");
    if (isError) els.toast.classList.add("error");
    toastTimer = setTimeout(() => els.toast.classList.add("hidden"), 3200);
  }

  async function get(action, params = {}) {
    const url = new URL(CONFIG.API_URL);
    url.searchParams.set("action", action);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

    const response = await fetch(url.toString(), { method: "GET", cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  async function post(payload) {
    const response = await fetch(CONFIG.API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      redirect: "follow"
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  function friendlyError(error) {
    const raw = String(error?.message || error || "Unknown error");
    if (raw.includes("Failed to fetch")) return "Could not reach Google Sheets. Check the internet connection.";
    if (raw.includes("UNAUTHORIZED")) return "Session expired. Please log in again.";
    if (raw.includes("ADMIN_PIN_NOT_CONFIGURED")) return "The owner PIN has not been configured in Apps Script.";
    return raw.replaceAll("_", " ");
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }
})();