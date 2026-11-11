const root = document.querySelector("#app");
const state = {
  user: null,
  workspace: null,
  view: "overview",
  drafts: [],
  draftPage: 1,
  draftTotal: 0,
  selectedDraft: null,
  notice: "",
  authMode: "register",
};

const platformNames = {
  general: "General",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  x: "X",
  threads: "Threads",
};

function element(tag, className = "", text = "") {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text) item.textContent = text;
  return item;
}

function iconMark() {
  const mark = element("span", "brand-mark");
  mark.setAttribute("aria-hidden", "true");
  mark.append(element("span", "brand-mark__line"), element("span", "brand-mark__line"));
  return mark;
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const error = new Error(payload.error || "The request could not be completed.");
    error.status = response.status;
    throw error;
  }
  return payload;
}

function setBusy(busy) {
  root.setAttribute("aria-busy", String(busy));
}

function showAuthError(target, message) {
  target.textContent = message;
  target.hidden = !message;
}

function renderAuth(mode = state.authMode) {
  state.authMode = mode;
  root.replaceChildren();
  root.className = "auth-page";

  const brand = element("a", "brand brand--light");
  brand.href = "/";
  brand.append(iconMark(), element("span", "brand__name", "Social Workspace"));

  const aside = element("section", "auth-aside");
  aside.append(
    brand,
    element("p", "eyebrow eyebrow--light", "A quieter way to work"),
    element("h1", "auth-aside__headline", "Build a content rhythm that feels like yours."),
    element("p", "auth-aside__copy", "Plan ideas in one private workspace. Connect official platforms when you’re ready."),
  );
  const asideFoot = element("div", "auth-aside__foot");
  asideFoot.append(element("span", "status-dot"), element("span", "", "Private by design"));
  aside.append(asideFoot);

  const panel = element("section", "auth-panel");
  const panelInner = element("div", "auth-card");
  panelInner.append(
    element("p", "eyebrow", mode === "register" ? "Get started" : "Welcome back"),
    element("h2", "auth-card__title", mode === "register" ? "Create your workspace" : "Sign in to continue"),
    element("p", "auth-card__intro", mode === "register"
      ? "Start with a secure personal workspace. You can invite your team later."
      : "Your content workspace is ready when you are."),
  );

  const switcher = element("div", "auth-switcher");
  switcher.setAttribute("role", "group");
  switcher.setAttribute("aria-label", "Choose sign-in method");
  for (const [buttonMode, label] of [["register", "Create account"], ["login", "Sign in"]]) {
    const tab = element("button", `auth-switcher__tab${mode === buttonMode ? " is-active" : ""}`, label);
    tab.type = "button";
    tab.setAttribute("aria-pressed", String(mode === buttonMode));
    tab.addEventListener("click", () => renderAuth(buttonMode));
    switcher.append(tab);
  }
  panelInner.append(switcher);

  const form = element("form", "auth-form");
  form.noValidate = false;
  if (mode === "register") {
    form.append(makeField("Your name", "name", "text", "Your name", { minLength: 2, maxLength: 60, autocomplete: "name" }));
  }
  form.append(makeField("Email address", "email", "email", "you@example.com", { maxLength: 254, autocomplete: "email" }));
  form.append(makeField("Password", "password", "password", "At least 12 characters", {
    minLength: mode === "register" ? 12 : 1,
    maxLength: 128,
    autocomplete: mode === "register" ? "new-password" : "current-password",
  }));

  const errorMessage = element("p", "form-message form-message--error");
  errorMessage.setAttribute("role", "alert");
  errorMessage.hidden = true;
  form.append(errorMessage);

  const submit = element("button", "button button--primary button--wide", mode === "register" ? "Create secure workspace" : "Sign in");
  submit.type = "submit";
  form.append(submit);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showAuthError(errorMessage, "");
    submit.disabled = true;
    submit.textContent = mode === "register" ? "Creating workspace…" : "Signing in…";
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    try {
      const session = await request(`/api/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify(data),
      });
      state.user = session.user;
      state.workspace = session.workspace;
      state.view = "overview";
      state.notice = mode === "register" ? "Your private workspace is ready." : "You’re signed in.";
      await renderWorkspace();
    } catch (error) {
      showAuthError(errorMessage, error.message);
      submit.disabled = false;
      submit.textContent = mode === "register" ? "Create secure workspace" : "Sign in";
    }
  });
  panelInner.append(form);

  const securityNote = element("p", "security-note");
  securityNote.append(element("span", "security-note__icon", "◆"), element("span", "", "Your password is protected. We never ask for social media passwords."));
  panelInner.append(securityNote);
  panel.append(panelInner);
  root.append(aside, panel);
  setBusy(false);
  const focusTarget = form.querySelector("input");
  focusTarget?.focus({ preventScroll: true });
}

function makeField(labelText, name, type, placeholder, options = {}) {
  const wrapper = element("label", "field");
  wrapper.append(element("span", "field__label", labelText));
  const input = element("input", "field__input");
  input.name = name;
  input.type = type;
  input.placeholder = placeholder;
  input.required = true;
  input.autocomplete = options.autocomplete || "off";
  if (options.minLength) input.minLength = options.minLength;
  if (options.maxLength) input.maxLength = options.maxLength;
  wrapper.append(input);
  return wrapper;
}

function button(label, className, onClick, type = "button") {
  const control = element("button", className, label);
  control.type = type;
  if (onClick) control.addEventListener("click", onClick);
  return control;
}

function dateLabel(value) {
  if (!value) return "No drafts yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently updated";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function greeting() {
  const hour = new Date().getHours();
  const salutation = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return `${salutation}, ${state.user.name.split(/\s+/)[0]}`;
}

function renderShell(view) {
  root.replaceChildren();
  root.className = "workspace-app";
  const shell = element("div", "app-shell");

  const sidebar = element("aside", "sidebar");
  const brand = element("a", "brand brand--sidebar");
  brand.href = "/";
  brand.append(iconMark(), element("span", "brand__name", "Social Workspace"));
  sidebar.append(brand);

  const workspaceLabel = element("div", "workspace-switcher");
  workspaceLabel.append(element("span", "workspace-switcher__avatar", state.workspace.name.slice(0, 1)), element("span", "workspace-switcher__name", state.workspace.name));
  sidebar.append(workspaceLabel, element("p", "nav-label", "WORKSPACE"));

  const nav = element("nav", "primary-nav");
  nav.setAttribute("aria-label", "Main navigation");
  for (const [viewName, label, symbol] of [["overview", "Overview", "⌂"], ["studio", "Content studio", "▤"]]) {
    const item = button("", `nav-item${view === viewName ? " is-active" : ""}`, () => navigate(viewName));
    item.setAttribute("aria-current", view === viewName ? "page" : "false");
    const itemIcon = element("span", "nav-item__icon", symbol);
    itemIcon.setAttribute("aria-hidden", "true");
    item.append(itemIcon, element("span", "", label));
    nav.append(item);
  }
  sidebar.append(nav);

  const sidebarFoot = element("div", "sidebar-foot");
  const readiness = element("div", "readiness-card");
  readiness.append(element("span", "readiness-card__label", "Publishing status"), element("span", "readiness-card__value", "Not connected"), element("p", "readiness-card__copy", "Official platform connections will appear here when available."));
  sidebarFoot.append(readiness);
  const identity = element("div", "identity-row");
  identity.append(element("span", "identity-row__avatar", initials(state.user.name)));
  const identityCopy = element("span", "identity-row__copy");
  identityCopy.append(element("strong", "", state.user.name), element("small", "", state.user.email));
  identity.append(identityCopy, button("Sign out", "quiet-button", signOut));
  sidebarFoot.append(identity);
  sidebar.append(sidebarFoot);

  const main = element("div", "app-main");
  const topbar = element("header", "topbar");
  topbar.append(element("span", "topbar__crumb", view === "studio" ? "Content studio" : "Overview"));
  topbar.append(element("span", "topbar__workspace", state.workspace.name));
  main.append(topbar);

  const content = element("section", "page-content");
  content.id = "page-content";
  main.append(content);
  shell.append(sidebar, main);
  root.append(shell);
  return content;
}

function initials(name) {
  return name.split(/\s+/).slice(0, 2).map((part) => part.slice(0, 1).toUpperCase()).join("");
}

function navigate(view) {
  state.view = view;
  state.notice = "";
  if (view === "studio") return renderStudio();
  return renderOverview();
}

async function refreshWorkspaceData(page = state.draftPage) {
  const [overview, draftResult] = await Promise.all([
    request("/api/overview"),
    request(`/api/drafts?page=${page}`),
  ]);
  state.drafts = draftResult.items;
  state.draftPage = draftResult.page;
  state.draftTotal = draftResult.total;
  return overview;
}

function renderNotice(target) {
  if (!state.notice) return;
  const notice = element("div", "notice", state.notice);
  notice.setAttribute("role", "status");
  target.append(notice);
  state.notice = "";
}

async function renderOverview() {
  state.view = "overview";
  const content = renderShell("overview");
  content.append(element("p", "eyebrow", "YOUR SPACE, AT A GLANCE"), element("h1", "page-title", greeting()));
  const intro = element("div", "page-intro");
  intro.append(element("p", "page-description", "Keep your ideas moving. Your workspace is private and ready for its first draft."));
  intro.append(button("＋  New draft", "button button--primary", () => {
    state.selectedDraft = null;
    void navigate("studio").then(() => document.querySelector("#draft-title")?.focus());
  }));
  content.append(intro);
  renderNotice(content);

  const loading = element("div", "loading-panel", "Loading your workspace data…");
  loading.setAttribute("role", "status");
  content.append(loading);
  setBusy(true);
  try {
    const overview = await refreshWorkspaceData(1);
    const summary = element("div", "summary-grid");
    summary.append(summaryCard("Drafts in your workspace", String(overview.draftCount), "Saved ideas and copy"));
    summary.append(summaryCard("Latest edit", dateLabel(overview.lastUpdated), "Your most recent draft"));
    loading.replaceWith(summary);

    const grid = element("div", "overview-grid");
    const recent = element("section", "surface recent-panel");
    const recentHeader = element("div", "section-heading");
    recentHeader.append(element("div", "", ""));
    recentHeader.firstChild.append(element("p", "eyebrow", "WORK IN PROGRESS"), element("h2", "section-title", "Recent drafts"));
    recentHeader.append(button("View studio  →", "text-button", () => navigate("studio")));
    recent.append(recentHeader);
    appendDraftList(recent, state.drafts.slice(0, 5), () => navigate("studio"));

    const side = element("div", "overview-side");
    const integrations = element("section", "surface integration-card");
    integrations.append(element("p", "eyebrow", "CONNECTED ACCOUNTS"), element("h2", "section-title", "Not connected"));
    integrations.append(element("p", "body-copy", "Publishing integrations are not enabled in this build. When added, each connection will use its platform’s official authorization flow."));
    const status = element("div", "honesty-note");
    status.append(element("span", "honesty-note__mark", "i"), element("span", "", "No social metrics are being simulated."));
    integrations.append(status);
    const tip = element("section", "tip-card");
    tip.append(element("span", "tip-card__number", "01"), element("div", "", ""));
    tip.lastChild.append(element("h3", "tip-card__title", "Start with a clear idea"), element("p", "tip-card__copy", "Save a draft, choose its intended platform, and shape it before you publish."));
    side.append(integrations, tip);
    grid.append(recent, side);
    content.append(grid);
  } catch (error) {
    if (error.status === 401) {
      state.user = null;
      renderAuth("login");
      return;
    }
    loading.className = "error-panel";
    loading.textContent = error.message;
  } finally {
    setBusy(false);
  }
}

function summaryCard(label, value, detail) {
  const card = element("section", "summary-card");
  card.append(element("span", "summary-card__label", label), element("strong", "summary-card__value", value), element("span", "summary-card__detail", detail));
  return card;
}

function appendDraftList(target, drafts, onSelect) {
  if (drafts.length === 0) {
    const empty = element("div", "empty-state");
    empty.append(element("span", "empty-state__icon", "＋"), element("h3", "empty-state__title", "Your first idea starts here"), element("p", "empty-state__copy", "Create a draft and keep your content in one place."));
    empty.append(button("Create a draft", "button button--secondary", onSelect));
    target.append(empty);
    return;
  }

  const list = element("div", "draft-list");
  for (const draft of drafts) {
    const row = button("", "draft-row", () => {
      state.selectedDraft = draft.id;
      onSelect();
    });
    const rowMain = element("span", "draft-row__main");
    rowMain.append(element("strong", "draft-row__title", draft.title), element("span", "draft-row__meta", `${platformNames[draft.platform] || "General"} · Edited ${dateLabel(draft.updatedAt)}`));
    row.append(rowMain, element("span", "draft-row__arrow", "↗"));
    list.append(row);
  }
  target.append(list);
}

async function renderStudio() {
  state.view = "studio";
  const content = renderShell("studio");
  content.append(element("p", "eyebrow", "IDEAS BEFORE THEY GO LIVE"), element("h1", "page-title", "Content studio"));
  const intro = element("div", "page-intro");
  intro.append(element("p", "page-description", "Create and organize drafts. Saving here does not publish or send anything to a social platform."));
  intro.append(button("＋  New draft", "button button--primary", () => {
    state.selectedDraft = null;
    void renderStudio().then(() => document.querySelector("#draft-title")?.focus());
  }));
  content.append(intro);
  renderNotice(content);

  const workspace = element("div", "studio-grid");
  const listPanel = element("section", "surface studio-list-panel");
  const listHead = element("div", "section-heading");
  const listHeadCopy = element("div");
  listHeadCopy.append(element("p", "eyebrow", "PRIVATE TO THIS WORKSPACE"), element("h2", "section-title", "Draft library"));
  listHead.append(listHeadCopy, element("span", "count-pill", String(state.draftTotal)));
  listPanel.append(listHead);
  const listLoading = element("div", "loading-panel", "Loading drafts…");
  listPanel.append(listLoading);

  const editorPanel = element("section", "surface editor-panel");
  const editorHeader = element("div", "editor-heading");
  editorHeader.append(element("div", "editor-heading__icon", state.selectedDraft ? "✎" : "＋"), element("div", "", ""));
  editorHeader.lastChild.append(element("p", "eyebrow", state.selectedDraft ? "EDIT DRAFT" : "NEW CONTENT"), element("h2", "section-title", state.selectedDraft ? "Refine your idea" : "Start a draft"));
  editorPanel.append(editorHeader);
  const editor = createDraftEditor(editorPanel);
  workspace.append(listPanel, editorPanel);
  content.append(workspace);
  setBusy(true);

  try {
    await refreshWorkspaceData(state.draftPage);
    listLoading.remove();
    appendStudioDraftList(listPanel, state.drafts);
    updateEditor(editor, state.drafts.find((draft) => draft.id === state.selectedDraft) || null);
  } catch (error) {
    if (error.status === 401) {
      state.user = null;
      renderAuth("login");
      return;
    }
    listLoading.className = "error-panel";
    listLoading.textContent = error.message;
    editor.form.hidden = true;
  } finally {
    setBusy(false);
  }
}

function appendStudioDraftList(target, drafts) {
  if (drafts.length === 0 && state.draftPage === 1) {
    const empty = element("div", "empty-state empty-state--compact");
    empty.append(element("span", "empty-state__icon", "✦"), element("h3", "empty-state__title", "Nothing saved yet"), element("p", "empty-state__copy", "Your drafts will stay private in this workspace."));
    target.append(empty);
  } else if (drafts.length > 0) {
    const list = element("div", "studio-draft-list");
    for (const draft of drafts) {
      const item = button("", `studio-draft${draft.id === state.selectedDraft ? " is-selected" : ""}`, () => {
        state.selectedDraft = draft.id;
        renderStudio();
      });
      item.append(element("span", "studio-draft__platform", platformNames[draft.platform] || "General"));
      item.append(element("strong", "studio-draft__title", draft.title));
      item.append(element("span", "studio-draft__date", dateLabel(draft.updatedAt)));
      list.append(item);
    }
    target.append(list);
  }

  const totalPages = Math.max(1, Math.ceil(state.draftTotal / 20));
  if (totalPages > 1) {
    const pagination = element("div", "pagination");
    pagination.append(button("← Previous", "quiet-button", () => changeDraftPage(state.draftPage - 1), "button"));
    pagination.append(element("span", "pagination__label", `Page ${state.draftPage} of ${totalPages}`));
    pagination.append(button("Next →", "quiet-button", () => changeDraftPage(state.draftPage + 1), "button"));
    pagination.querySelector("button:first-child").disabled = state.draftPage <= 1;
    pagination.querySelector("button:last-child").disabled = state.draftPage >= totalPages;
    target.append(pagination);
  }
}

function changeDraftPage(page) {
  state.draftPage = page;
  state.selectedDraft = null;
  renderStudio();
}

function createDraftEditor(target) {
  const form = element("form", "draft-form");
  form.hidden = true;

  const titleField = element("label", "field");
  titleField.append(element("span", "field__label", "Draft title"));
  const title = element("input", "field__input");
  title.id = "draft-title";
  title.name = "title";
  title.placeholder = "A clear, memorable working title";
  title.required = true;
  title.maxLength = 120;
  titleField.append(title);
  form.append(titleField);

  const platformField = element("label", "field");
  platformField.append(element("span", "field__label", "Intended platform"));
  const platform = element("select", "field__input");
  platform.name = "platform";
  for (const [value, label] of Object.entries(platformNames)) {
    const option = element("option", "", label);
    option.value = value;
    platform.append(option);
  }
  platformField.append(platform);
  form.append(platformField);

  const bodyField = element("label", "field field--body");
  bodyField.append(element("span", "field__label", "Content"));
  const body = element("textarea", "field__input field__textarea");
  body.name = "body";
  body.placeholder = "Write a first line, a rough caption, or the idea you want to explore…";
  body.required = true;
  body.maxLength = 5000;
  body.rows = 8;
  bodyField.append(body);
  form.append(bodyField);

  const fieldNote = element("span", "field-note", "Up to 5,000 characters. This draft stays private until you choose what to do with it.");
  form.append(fieldNote);
  const error = element("p", "form-message form-message--error");
  error.setAttribute("role", "alert");
  error.hidden = true;
  form.append(error);
  const success = element("p", "form-message form-message--success");
  success.setAttribute("role", "status");
  success.hidden = true;
  form.append(success);

  const actions = element("div", "form-actions");
  const save = button("Save draft", "button button--primary", null, "submit");
  const remove = button("Delete", "button button--danger", null);
  remove.hidden = true;
  remove.addEventListener("click", async () => {
    if (!state.selectedDraft || !window.confirm("Delete this draft? This cannot be undone.")) return;
    remove.disabled = true;
    try {
      await request(`/api/drafts/${state.selectedDraft}`, { method: "DELETE" });
      state.notice = "Draft deleted.";
      state.selectedDraft = null;
      state.draftPage = 1;
      renderStudio();
    } catch (requestError) {
      showAuthError(error, requestError.message);
      remove.disabled = false;
    }
  });
  actions.append(save, remove);
  form.append(actions);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showAuthError(error, "");
    success.hidden = true;
    save.disabled = true;
    save.textContent = "Saving…";
    const data = Object.fromEntries(new FormData(form).entries());
    const isEditing = Boolean(state.selectedDraft);
    try {
      const saved = await request(isEditing ? `/api/drafts/${state.selectedDraft}` : "/api/drafts", {
        method: isEditing ? "PATCH" : "POST",
        body: JSON.stringify(data),
      });
      state.selectedDraft = saved.id;
      state.draftPage = 1;
      state.notice = "Draft saved to your workspace.";
      await renderStudio();
      document.querySelector("#draft-title")?.focus({ preventScroll: true });
    } catch (requestError) {
      showAuthError(error, requestError.message);
      save.disabled = false;
      save.textContent = "Save draft";
    }
  });
  target.append(form);
  return { form, title, platform, body, error, success, save, remove };
}

function updateEditor(editor, draft) {
  editor.form.hidden = false;
  editor.title.value = draft?.title || "";
  editor.platform.value = draft?.platform || "general";
  editor.body.value = draft?.body || "";
  editor.remove.hidden = !draft;
  editor.save.textContent = draft ? "Save changes" : "Save draft";
  editor.success.hidden = true;
  editor.error.hidden = true;
}

async function signOut() {
  try {
    await request("/api/auth/logout", { method: "POST", body: "{}" });
  } catch {
    state.notice = "We couldn’t reach the server to sign out. Please try again.";
    await renderWorkspace();
    return;
  }
  state.user = null;
  state.workspace = null;
  state.drafts = [];
  state.selectedDraft = null;
  state.notice = "You’ve signed out.";
  renderAuth("login");
}

async function renderWorkspace() {
  setBusy(true);
  try {
    if (state.view === "studio") await renderStudio();
    else await renderOverview();
  } finally {
    setBusy(false);
  }
}

async function start() {
  setBusy(true);
  try {
    const session = await request("/api/auth/session");
    state.user = session.user;
    state.workspace = session.workspace;
    await renderOverview();
  } catch (error) {
    if (error.status === 401) renderAuth("register");
    else {
      root.replaceChildren();
      root.className = "startup-error";
      root.append(element("h1", "page-title", "We couldn’t load your workspace"), element("p", "page-description", error.message));
      root.append(button("Try again", "button button--primary", start));
      setBusy(false);
    }
  }
}

start();
