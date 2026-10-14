const adminApi = {
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

const adminState = {
  settings: null,
  users: [],
  payments: [],
  stats: null,
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

function renderSummary() {
  const stats = adminState.stats || {};
  const html = `
    <div class="summary-grid">
      <div class="stat-box">
        <span>Total users</span>
        <strong>${Number(stats.users || 0)}</strong>
      </div>
      <div class="stat-box">
        <span>Pending reviews</span>
        <strong>${Number(stats.pending || 0)}</strong>
      </div>
      <div class="stat-box">
        <span>Analyses logged</span>
        <strong>${Number(stats.analyses || 0)}</strong>
      </div>
    </div>
  `;
  document.getElementById("adminSummary").innerHTML = html;
}

function renderPricingForm() {
  const settings = adminState.settings || {
    registrationFee: 50,
    customGhsPerCredit: 5,
    packages: [],
    analysisTypes: [],
  };

  const form = document.getElementById("pricingForm");
  form.elements.registrationFee.value = settings.registrationFee;
  form.elements.customGhsPerCredit.value = settings.customGhsPerCredit;

  const packagesEditor = document.getElementById("packagesEditor");
  packagesEditor.innerHTML = settings.packages.map(
    (pkg) => `
      <div class="editor-row">
        <input name="packageId" data-package-id="${pkg.id}" value="${pkg.id}" placeholder="ID" />
        <input name="packageName" data-package-id="${pkg.id}" value="${pkg.name}" placeholder="Name" />
        <input name="packageCredits" type="number" data-package-id="${pkg.id}" value="${pkg.credits}" placeholder="Credits" />
        <input name="packagePrice" type="number" step="0.01" data-package-id="${pkg.id}" value="${pkg.price}" placeholder="Price" />
      </div>
    `
  ).join("");

  const analysisEditor = document.getElementById("analysisEditor");
  analysisEditor.innerHTML = settings.analysisTypes.map(
    (type) => `
      <div class="editor-row">
        <input name="typeId" data-type-id="${type.id}" value="${type.id}" placeholder="ID" />
        <input name="typeName" data-type-id="${type.id}" value="${type.name}" placeholder="Analysis name" />
        <input name="typeCost" type="number" data-type-id="${type.id}" value="${type.cost}" placeholder="Cost" />
      </div>
    `
  ).join("");
}

function renderUsers() {
  const tbody = document.getElementById("usersTableBody");
  tbody.innerHTML = (adminState.users || []).map((user) => `
    <tr>
      <td>${user.name}</td>
      <td>${user.email}</td>
      <td>${user.role}</td>
      <td>${user.registration_status}</td>
      <td>${user.credits}</td>
      <td>
        <div class="inline-actions">
          <button class="small action" data-user-id="${user.id}" data-delta="10">+10</button>
          <button class="small action" data-user-id="${user.id}" data-delta="-10">-10</button>
        </div>
      </td>
    </tr>
  `).join("");

  document.querySelectorAll("[data-user-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.userId;
      const delta = Number(btn.dataset.delta);
      try {
        await adminApi.request(`/api/admin/users/${id}/credits`, {
          method: "POST",
          body: JSON.stringify({ delta }),
        });
        await loadAdmin();
        showToast("Credits updated.", "success");
      } catch (error) {
        showToast(error.message, "error");
      }
    });
  });
}

function renderPayments() {
  const tbody = document.getElementById("paymentsTableBody");
  tbody.innerHTML = (adminState.payments || []).map((payment) => `
    <tr>
      <td>${payment.name}<br /><small>${payment.email}</small></td>
      <td>${payment.kind}</td>
      <td>${currency(payment.amount_ghs)}</td>
      <td>${payment.payment_reference}</td>
      <td>
        ${payment.proof_mime ? `<a href="/api/admin/payments/${payment.id}/proof" target="_blank" rel="noreferrer">View proof</a>` : "—"}
      </td>
      <td>${payment.status}</td>
      <td>
        ${payment.status === "pending" ? `
          <div class="inline-actions">
            <button class="small success" data-review-id="${payment.id}" data-decision="approve">Approve</button>
            <button class="small danger" data-review-id="${payment.id}" data-decision="reject">Reject</button>
          </div>
        ` : "—"}
      </td>
    </tr>
  `).join("");

  document.querySelectorAll("[data-review-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.reviewId;
      const decision = btn.dataset.decision;
      try {
        await adminApi.request(`/api/admin/payments/${id}/review`, {
          method: "POST",
          body: JSON.stringify({ decision }),
        });
        await loadAdmin();
        showToast("Review saved.", "success");
      } catch (error) {
        showToast(error.message, "error");
      }
    });
  });
}

async function loadAdmin() {
  try {
    const data = await adminApi.request("/api/admin");
    adminState.settings = data.settings;
    adminState.users = data.users;
    adminState.payments = data.payments;
    adminState.stats = data.stats;
    renderSummary();
    renderPricingForm();
    renderUsers();
    renderPayments();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function handlePricingSubmit(event) {
  event.preventDefault();

  const form = event.target;
  const packageIds = [...document.querySelectorAll('[name="packageId"]')].map((el) => el.value);
  const packageNames = [...document.querySelectorAll('[name="packageName"]')].map((el) => el.value);
  const packageCredits = [...document.querySelectorAll('[name="packageCredits"]')].map((el) => Number(el.value));
  const packagePrices = [...document.querySelectorAll('[name="packagePrice"]')].map((el) => Number(el.value));

  const typeIds = [...document.querySelectorAll('[name="typeId"]')].map((el) => el.value);
  const typeNames = [...document.querySelectorAll('[name="typeName"]')].map((el) => el.value);
  const typeCosts = [...document.querySelectorAll('[name="typeCost"]')].map((el) => Number(el.value));

  const payload = {
    registrationFee: Number(form.elements.registrationFee.value),
    customGhsPerCredit: Number(form.elements.customGhsPerCredit.value),
    packages: packageIds.map((id, i) => ({
      id,
      name: packageNames[i],
      credits: packageCredits[i],
      price: packagePrices[i],
    })),
    analysisTypes: typeIds.map((id, i) => ({
      id,
      name: typeNames[i],
      cost: typeCosts[i],
    })),
  };

  try {
    await adminApi.request("/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    await loadAdmin();
    showToast("Pricing updated.", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function handleAdminLogout() {
  try {
    await adminApi.request("/api/logout", { method: "POST" });
    window.location.href = "/";
  } catch (error) {
    showToast(error.message, "error");
  }
}

document.getElementById("pricingForm")?.addEventListener("submit", handlePricingSubmit);
document.getElementById("logoutAdminBtn")?.addEventListener("click", handleAdminLogout);

(async function init() {
  await loadAdmin();
})();
