const api = {
  async request(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
      credentials: "same-origin",
    });

    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { message: text };
    }

    if (!response.ok) {
      throw new Error(data.error || data.message || "Request failed.");
    }

    return data;
  },
};

const state = {
  config: null,
  user: null,
  dashboard: null,
};

const els = {
  packageList: document.getElementById("packageList"),
  packageSelect: document.getElementById("packageSelect"),
  analysisTypeSelect: document.getElementById("analysisTypeSelect"),
  registrationFeeChip: document.getElementById("registrationFeeChip"),
  accountInfo: document.getElementById("accountInfo"),
  logoutBtn: document.getElementById("logoutBtn"),
  analysisOutput: document.getElementById("analysisOutput"),
};

function currency(value) {
  return new Intl.NumberFormat("en-GH", { style: "currency", currency: "GHS" }).format(value || 0);
}

function showToast(message, type = "info") {
  const box = document.createElement("div");
  box.className = `toast ${type}`;
  box.textContent = message;
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 2600);
}

async function refreshConfig() {
  const cfg = await api.request("/api/config");
  state.config = cfg;

  els.registrationFeeChip.textContent = `Registration fee: ${currency(cfg.registrationFee)}`;

  const packageCards = cfg.packages
    .map(
      (pkg) => `
        <article class="package-card">
          <div class="package-top">
            <h3>${pkg.name}</h3>
            <span>${pkg.credits} credits</span>
          </div>
          <p class="price">${currency(pkg.price)}</p>
          <small>Price and quantity from current admin settings</small>
        </article>
      `
    )
    .join("");

  els.packageList.innerHTML = packageCards;

  els.packageSelect.innerHTML = ['<option value="">Custom amount</option>']
    .concat(
      cfg.packages.map((pkg) => `<option value="${pkg.id}">${pkg.name} — ${currency(pkg.price)}</option>`)
    )
    .join("");

  els.analysisTypeSelect.innerHTML = cfg.analysisTypes
    .map((type) => `<option value="${type.id}">${type.name} (${type.cost} credits)</option>`)
    .join("");
}

async function loadMe() {
  try {
    const data = await api.request("/api/me");
    state.user = data.user;
    renderAccount();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function loadDashboard() {
  if (!state.user) return;
  try {
    const data = await api.request("/api/dashboard");
    state.dashboard = data;
    renderAccount();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderAccount() {
  if (!state.user) {
    els.accountInfo.textContent = "Sign in to view your account.";
    els.logoutBtn.classList.add("hide");
    return;
  }

  const statusText = state.user.registration_status === "approved" ? "Approved" : state.user.registration_status;
  const credits = state.dashboard?.user ? state.dashboard.user.credits : state.user.credits;

  els.accountInfo.innerHTML = `
    <div class="account-grid">
      <div><strong>Name:</strong> ${state.user.name}</div>
      <div><strong>Email:</strong> ${state.user.email}</div>
      <div><strong>Role:</strong> ${state.user.role}</div>
      <div><strong>Registration:</strong> ${statusText}</div>
      <div><strong>Credits:</strong> ${credits}</div>
    </div>
  `;

  els.logoutBtn.classList.remove("hide");
}

async function handleRegister(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const payload = Object.fromEntries(form.entries());

  try {
    const res = await api.request("/api/register", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    state.user = res.user;
    await loadDashboard();
    event.target.reset();
    showToast(res.message || "Account created.", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const payload = Object.fromEntries(form.entries());

  try {
    const res = await api.request("/api/login", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    state.user = res.user;
    await loadDashboard();
    event.target.reset();
    showToast("Signed in.", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function handleLogout() {
  try {
    await api.request("/api/logout", { method: "POST" });
    state.user = null;
    state.dashboard = null;
    renderAccount();
    showToast("Signed out.", "info");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function handlePayment(event) {
  event.preventDefault();
  if (!state.user) {
    showToast("Please sign in first.", "error");
    return;
  }

  const form = new FormData(event.target);
  const payload = new FormData();
  Array.from(form.entries()).forEach(([key, value]) => {
    if (value instanceof File && value.size > 0) payload.append(key, value);
    else if (!(value instanceof File)) payload.append(key, value);
  });

  try {
    const res = await fetch("/api/payments", {
      method: "POST",
      body: payload,
      credentials: "same-origin",
    });

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }

    if (!res.ok) throw new Error(data.error || data.message || "Payment failed.");

    event.target.reset();
    await loadDashboard();
    showToast(data.message, "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function handleAnalysis(event) {
  event.preventDefault();
  if (!state.user) {
    showToast("Please sign in first.", "error");
    return;
  }

  const form = new FormData(event.target);
  const payload = new FormData();
  Array.from(form.entries()).forEach(([key, value]) => {
    if (value instanceof File && value.size > 0) payload.append(key, value);
    else if (!(value instanceof File)) payload.append(key, value);
  });

  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      body: payload,
      credentials: "same-origin",
    });

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }

    if (!res.ok) throw new Error(data.error || data.message || "Analysis failed.");

    els.analysisOutput.innerHTML = `<pre>${escapeHtml(data.result)}</pre>`;
    await loadDashboard();
    showToast(`Analysis complete. ${data.creditsUsed} credits used.`, "success");
  } catch (error) {
    els.analysisOutput.innerHTML = `<div class="error-box">${escapeHtml(error.message)}</div>`;
    showToast(error.message, "error");
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

document.querySelector("[data-scroll]")?.addEventListener("click", (event) => {
  const id = event.currentTarget.dataset.scroll;
  document.querySelector(id)?.scrollIntoView({ behavior: "smooth" });
});

document.getElementById("registerForm")?.addEventListener("submit", handleRegister);
document.getElementById("loginForm")?.addEventListener("submit", handleLogin);
document.getElementById("logoutBtn")?.addEventListener("click", handleLogout);
document.getElementById("paymentForm")?.addEventListener("submit", handlePayment);
document.getElementById("analysisForm")?.addEventListener("submit", handleAnalysis);

(async function init() {
  await refreshConfig();
  await loadMe();
  if (state.user) await loadDashboard();
})();
