const NAV_ITEMS = [
  { key: "home", href: "./index.html", label: "Home" },
  { key: "leaderboard", href: "./public-leaderboard.html", label: "Leaderboard" },
  { key: "admin", href: "./admin.html", label: "Admin" }
];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function takeMeaningfulChildren(element) {
  const fragment = document.createDocumentFragment();
  for (const node of [...element.childNodes]) {
    if (node.nodeType === Node.TEXT_NODE && String(node.textContent ?? "").trim() === "") {
      element.removeChild(node);
      continue;
    }
    fragment.appendChild(node);
  }
  return fragment;
}

class PoolPageHero extends HTMLElement {
  connectedCallback() {
    if (this.dataset.componentReady === "1") return;
    this.dataset.componentReady = "1";

    const kicker = this.getAttribute("kicker") ?? "";
    const title = this.getAttribute("title") ?? "";
    const subtitle = this.getAttribute("subtitle") ?? "";
    const activePage = this.getAttribute("active-page") ?? "";
    const metaId = this.getAttribute("meta-id") ?? "meta-line";
    const metaExtraId = this.getAttribute("meta-extra-id");
    const refreshId = this.getAttribute("refresh-id") ?? "refresh-indicator";
    const showRefresh = this.hasAttribute("refresh");
    const actionId = this.getAttribute("action-id");
    const actionLabel = this.getAttribute("action-label") ?? "";
    const actionPlacement = this.getAttribute("action-placement") ?? "top";

    this.classList.add("hero", "card");
    if (!kicker) this.classList.add("hero-no-kicker");
    if (actionId && actionPlacement === "bottom-right") this.classList.add("hero-action-bottom");
    this.innerHTML = `
      <div class="hero-top">
        ${kicker ? `<p class="kicker">${escapeHtml(kicker)}</p>` : ""}
        <div class="hero-top-actions">
          <nav class="hero-nav" aria-label="Page navigation">
            ${NAV_ITEMS.map((item) => {
              const activeClass = item.key === activePage ? ' class="is-active"' : "";
              return `<a href="${item.href}"${activeClass}>${item.label}</a>`;
            }).join("")}
          </nav>
          ${
            actionId && actionPlacement !== "bottom-right"
              ? `<button id="${escapeHtml(actionId)}" class="hero-action-btn secondary" type="button">${escapeHtml(actionLabel)}</button>`
              : ""
          }
        </div>
      </div>
      <h1>${escapeHtml(title)}</h1>
      ${subtitle ? `<p class="hero-subtitle">${escapeHtml(subtitle)}</p>` : ""}
      <p id="${escapeHtml(metaId)}">Loading data...</p>
      ${metaExtraId ? `<p id="${escapeHtml(metaExtraId)}" class="hero-meta-extra"></p>` : ""}
      ${
        actionId && actionPlacement === "bottom-right"
          ? `<div class="hero-bottom-actions"><button id="${escapeHtml(actionId)}" class="hero-action-btn secondary" type="button">${escapeHtml(actionLabel)}</button></div>`
          : ""
      }
      ${
        showRefresh
          ? `<p id="${escapeHtml(refreshId)}" class="live-refresh" data-status="pending">Checking live updates...</p>`
          : ""
      }
    `;
  }
}

class PoolSectionHead extends HTMLElement {
  connectedCallback() {
    if (this.dataset.componentReady === "1") return;
    this.dataset.componentReady = "1";

    const title = this.getAttribute("title") ?? "";
    const copy = this.getAttribute("copy");
    const copyId = this.getAttribute("copy-id");
    const copyTag = this.getAttribute("copy-tag") ?? "p";

    this.classList.add("section-head");

    const copyMarkup =
      copy !== null || copyId
        ? `<${copyTag}${copyId ? ` id="${escapeHtml(copyId)}"` : ""}>${escapeHtml(copy ?? "")}</${copyTag}>`
        : "";

    this.innerHTML = `<h2>${escapeHtml(title)}</h2>${copyMarkup}`;
  }
}

class PoolSectionHeadActions extends HTMLElement {
  connectedCallback() {
    if (this.dataset.componentReady === "1") return;
    this.dataset.componentReady = "1";

    const content = takeMeaningfulChildren(this);
    const title = this.getAttribute("title") ?? "";

    this.classList.add("section-head");

    const heading = document.createElement("h2");
    heading.textContent = title;
    this.appendChild(heading);

    const actions = document.createElement("div");
    actions.className = "detail-head-controls";
    actions.appendChild(content);
    this.appendChild(actions);
  }
}

class PoolCardSection extends HTMLElement {
  connectedCallback() {
    if (this.dataset.componentReady === "1") return;
    this.dataset.componentReady = "1";

    const content = takeMeaningfulChildren(this);
    const title = this.getAttribute("title");
    const copy = this.getAttribute("copy");
    const copyId = this.getAttribute("copy-id");
    const copyTag = this.getAttribute("copy-tag");

    this.classList.add("card");

    if (title || copy !== null || copyId) {
      const head = document.createElement("pool-section-head");
      if (title) head.setAttribute("title", title);
      if (copy !== null) head.setAttribute("copy", copy);
      if (copyId) head.setAttribute("copy-id", copyId);
      if (copyTag) head.setAttribute("copy-tag", copyTag);
      this.appendChild(head);
    }

    this.appendChild(content);
  }
}

class PoolCollapsibleCard extends HTMLElement {
  connectedCallback() {
    if (this.dataset.componentReady === "1") return;
    this.dataset.componentReady = "1";

    const content = takeMeaningfulChildren(this);
    const summaryText = this.getAttribute("summary") ?? "";
    const contentClass = this.getAttribute("content-class");
    const summaryClass = this.getAttribute("summary-class");

    this.classList.add("panel-collapsible");
    if (this.hasAttribute("card")) this.classList.add("card");

    const details = document.createElement("details");
    if (this.hasAttribute("open")) {
      details.open = true;
      this.setAttribute("open", "");
    } else {
      this.removeAttribute("open");
    }

    const summary = document.createElement("summary");
    summary.textContent = summaryText;
    if (summaryClass) summary.className = summaryClass;

    details.appendChild(summary);

    if (contentClass) {
      const body = document.createElement("div");
      body.className = contentClass;
      body.appendChild(content);
      details.appendChild(body);
    } else {
      details.appendChild(content);
    }

    details.addEventListener("toggle", () => {
      if (details.open) this.setAttribute("open", "");
      else this.removeAttribute("open");
    });

    this.appendChild(details);
  }
}

class PoolTableWorkspace extends HTMLElement {
  connectedCallback() {
    if (this.dataset.componentReady === "1") return;
    this.dataset.componentReady = "1";

    const content = takeMeaningfulChildren(this);
    const controls = [...content.childNodes].find(
      (node) => node.nodeType === Node.ELEMENT_NODE && node.hasAttribute?.("data-workspace-controls")
    );
    const table = [...content.childNodes].find(
      (node) => node.nodeType === Node.ELEMENT_NODE && node.hasAttribute?.("data-workspace-table")
    );

    this.classList.add("table-workspace");

    if (controls) {
      controls.classList.add("table-workspace-controls");
      this.appendChild(controls);
    }

    if (table) {
      table.classList.add("table-workspace-table");
      this.appendChild(table);
    }

    for (const node of [...content.childNodes]) {
      this.appendChild(node);
    }
  }
}

class PoolTwoColSection extends HTMLElement {
  connectedCallback() {
    if (this.dataset.componentReady === "1") return;
    this.dataset.componentReady = "1";

    this.classList.add("card", "two-col");
  }
}

class PoolStatusGrid extends HTMLElement {
  connectedCallback() {
    if (this.dataset.componentReady === "1") return;
    this.dataset.componentReady = "1";

    this.classList.add("status-grid");
  }
}

class PoolTableWrap extends HTMLElement {
  connectedCallback() {
    if (this.dataset.componentReady === "1") return;
    this.dataset.componentReady = "1";

    this.classList.add("table-wrap");
  }
}

customElements.define("pool-page-hero", PoolPageHero);
customElements.define("pool-section-head", PoolSectionHead);
customElements.define("pool-section-head-actions", PoolSectionHeadActions);
customElements.define("pool-card-section", PoolCardSection);
customElements.define("pool-collapsible-card", PoolCollapsibleCard);
customElements.define("pool-table-workspace", PoolTableWorkspace);
customElements.define("pool-two-col-section", PoolTwoColSection);
customElements.define("pool-status-grid", PoolStatusGrid);
customElements.define("pool-table-wrap", PoolTableWrap);
