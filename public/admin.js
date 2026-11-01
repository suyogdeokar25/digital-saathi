const loginPanel = document.getElementById("loginPanel");
const dashboardPanel = document.getElementById("dashboardPanel");
const loginForm = document.getElementById("loginForm");
const loginMessage = document.getElementById("loginMessage");
let learnerData = [];

async function checkLogin() {
  try {
    const response = await fetch("/api/admin/status");
    const result = await response.json();
    if (result.loggedIn) showDashboard();
  } catch {}
}
function showDashboard() { loginPanel.hidden = true; dashboardPanel.hidden = false; loadLearners(); }
loginForm.addEventListener("submit", async e => {
  e.preventDefault();
  loginMessage.textContent = "";
  const button = loginForm.querySelector("button");
  button.disabled = true; button.textContent = "Signing in…";
  try {
    const response = await fetch("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: document.getElementById("adminPassword").value }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Sign-in failed.");
    showDashboard();
  } catch (error) { loginMessage.className = "form-message error"; loginMessage.textContent = error.message; }
  finally { button.disabled = false; button.textContent = "Sign in"; }
});
async function loadLearners() {
  const tbody = document.getElementById("learnerRows");
  try {
    const response = await fetch("/api/admin/learners");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not load records.");
    learnerData = result;
    document.getElementById("recordCount").textContent = `${result.length} registration${result.length === 1 ? "" : "s"} found`;
    tbody.innerHTML = result.length ? result.map(row => `<tr>
      <td><b>${esc(row.full_name)}</b></td><td>${esc(row.age || "—")}</td><td>${esc(row.phone || "—")}</td><td>${esc(row.location || "—")}</td><td>${esc(row.learning_goal || "—")}</td><td>${esc(row.experience || "Beginner")}</td><td>${row.privacy_consent ? "Yes" : "No"}</td><td>${esc(row.created_at || "—")}</td>
      <td><button class="delete-button" data-delete="${row.id}" aria-label="Delete ${esc(row.full_name)}">Delete</button></td></tr>`).join("") : '<tr><td colspan="9" class="empty-state">No registrations yet. Submit the form on the main website to test it.</td></tr>';
  } catch (error) { tbody.innerHTML = `<tr><td colspan="9">${esc(error.message)}</td></tr>`; }
}
function esc(value) { return String(value).replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch])); }
document.getElementById("learnerRows").addEventListener("click", async e => {
  const button = e.target.closest("[data-delete]");
  if (!button || !confirm("Delete this learner registration?")) return;
  try {
    const response = await fetch(`/api/admin/learners/${button.dataset.delete}`, { method: "DELETE" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Delete failed.");
    loadLearners();
  } catch (error) { alert(error.message); }
});
document.getElementById("logoutButton").addEventListener("click", async () => {
  await fetch("/api/admin/logout", { method: "POST" });
  dashboardPanel.hidden = true; loginPanel.hidden = false; loginForm.reset();
});
document.getElementById("exportCsv").addEventListener("click", () => {
  const headers = ["Name","Age","Phone","Location","Learning goal","Experience","Privacy acknowledged","Registered"];
  const rows = learnerData.map(r => [r.full_name, r.age, r.phone, r.location, r.learning_goal, r.experience, r.privacy_consent ? "Yes" : "No", r.created_at]);
  const csvSafe = value => {
    let text = String(value ?? "");
    if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const csv = [headers, ...rows].map(row => row.map(csvSafe).join(",")).join("\r\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = "digital-saathi-learners.csv"; a.click(); URL.revokeObjectURL(url);
});
checkLogin();


const videoForm = document.getElementById("videoForm");
if (videoForm) {
  videoForm.addEventListener("submit", async e => {
    e.preventDefault();
    const message = document.getElementById("videoMessage");
    const button = videoForm.querySelector('button[type="submit"]');
    button.disabled = true; button.textContent = "Adding…"; message.textContent = "";
    try {
      const data = Object.fromEntries(new FormData(videoForm).entries());
      const response = await fetch("/api/admin/videos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not add video.");
      message.className = "form-message success"; message.textContent = result.message;
      videoForm.reset(); document.getElementById("videoCategory").value = "General";
      loadAdminVideos();
    } catch (error) { message.className = "form-message error"; message.textContent = error.message; }
    finally { button.disabled = false; button.textContent = "Add video"; }
  });
}
async function loadAdminVideos() {
  const list = document.getElementById("adminVideoList");
  if (!list) return;
  try {
    const response = await fetch("/api/videos"); const videos = await response.json();
    if (!response.ok) throw new Error("Could not load videos.");
    list.innerHTML = videos.length ? videos.map(v => `<div class="admin-video-row"><div><b>${esc(v.title)}</b><small>${esc(v.category)} · ${esc(v.video_url)}</small></div><button class="delete-button" type="button" data-delete-video="${v.id}">Remove</button></div>`).join("") : '<p>No videos published yet.</p>';
  } catch (e) { list.textContent = e.message; }
}
const adminVideoList = document.getElementById("adminVideoList");
if (adminVideoList) adminVideoList.addEventListener("click", async e => {
  const button = e.target.closest("[data-delete-video]");
  if (!button || !confirm("Remove this video from the learning page?")) return;
  button.disabled = true;
  try {
    const response = await fetch(`/api/admin/videos/${button.dataset.deleteVideo}`, { method: "DELETE" });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || "Could not remove video.");
    loadAdminVideos();
  } catch (error) { alert(error.message); button.disabled = false; }
});
const originalShowDashboard = showDashboard;
showDashboard = function() { originalShowDashboard(); loadAdminVideos(); };
