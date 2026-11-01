const lessonGrid = document.getElementById("lessonGrid");
const modal = document.getElementById("lessonModal");
let lessonsCache = [];

async function loadLessons() {
  try {
    const response = await fetch("/api/lessons");
    lessonsCache = await response.json();
    lessonGrid.innerHTML = lessonsCache.map((lesson, index) => `
      <article class="lesson-card">
        <div class="lesson-top"><span class="lesson-icon">${escapeHtml(lesson.icon)}</span><span class="lesson-number">${String(index + 1).padStart(2, "0")}</span></div>
        <span class="lesson-category">${escapeHtml(lesson.category)}</span>
        <h3>${escapeHtml(lesson.title)}</h3><p>${escapeHtml(lesson.description)}</p>
        <button class="text-link" data-lesson="${lesson.id}">Open lesson <span>→</span></button>
      </article>`).join("");
  } catch {
    lessonGrid.innerHTML = '<p class="error-box">Could not load lessons. Please refresh the page and check that the server is running.</p>';
  }
}
function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]));
}
function openLesson(id) {
  const lesson = lessonsCache.find(item => item.id === Number(id));
  if (!lesson) return;
  document.getElementById("modalIcon").textContent = lesson.icon;
  document.getElementById("modalCategory").textContent = lesson.category;
  document.getElementById("modalTitle").textContent = lesson.title;
  document.getElementById("modalDescription").textContent = lesson.description;
  document.getElementById("modalSteps").innerHTML = lesson.steps.split("\n").map(step => `<li>${escapeHtml(step.replace(/^\d+\.\s*/, ""))}</li>`).join("");
  modal.hidden = false;
  document.body.classList.add("modal-open");
  document.getElementById("closeModal").focus();
}
function closeModal() { modal.hidden = true; document.body.classList.remove("modal-open"); }
lessonGrid.addEventListener("click", e => { const button = e.target.closest("[data-lesson]"); if (button) openLesson(button.dataset.lesson); });
document.getElementById("closeModal").addEventListener("click", closeModal);
document.getElementById("doneLesson").addEventListener("click", closeModal);
modal.addEventListener("click", e => { if (e.target.dataset.close) closeModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !modal.hidden) closeModal(); });

document.getElementById("learnerForm").addEventListener("submit", async e => {
  e.preventDefault();
  const form = e.currentTarget;
  const message = document.getElementById("formMessage");
  const button = form.querySelector("button[type=submit]");
  button.disabled = true; button.textContent = "Submitting…"; message.textContent = "";
  const data = Object.fromEntries(new FormData(form).entries());
  data.privacy_consent = document.getElementById("privacyConsent").checked;
  try {
    const response = await fetch("/api/learners", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Submission failed.");
    message.className = "form-message success"; message.textContent = "✓ " + result.message + " Thank you!";
    form.reset();
  } catch (error) {
    message.className = "form-message error"; message.textContent = error.message || "Could not submit. Please try again.";
  } finally { button.disabled = false; button.innerHTML = 'Submit registration <span>→</span>'; }
});

let textScale = 1;
document.getElementById("largerText").addEventListener("click", () => { textScale = Math.min(1.2, textScale + 0.05); document.documentElement.style.setProperty("--text-scale", textScale); });
document.getElementById("smallerText").addEventListener("click", () => { textScale = Math.max(0.9, textScale - 0.05); document.documentElement.style.setProperty("--text-scale", textScale); });
loadLessons();


// Learning videos are managed from the admin dashboard.
function getVideoEmbed(url) {
  try {
    const u = new URL(url);
    let id = "";
    if (u.hostname === "youtu.be") id = u.pathname.slice(1);
    else if (u.hostname.endsWith("youtube.com")) {
      if (u.pathname === "/watch") id = u.searchParams.get("v") || "";
      else if (u.pathname.startsWith("/embed/")) id = u.pathname.split("/")[2] || "";
      else if (u.pathname.startsWith("/shorts/")) id = u.pathname.split("/")[2] || "";
    }
    if (id && /^[A-Za-z0-9_-]{6,20}$/.test(id)) return { type: "embed", src: "https://www.youtube-nocookie.com/embed/" + id };
    if (/\.mp4($|\?)/i.test(u.pathname + u.search)) return { type: "file", src: u.href };
    return { type: "link", src: u.href };
  } catch { return { type: "link", src: "#" }; }
}
async function loadVideos() {
  const grid = document.getElementById("videoGrid");
  if (!grid) return;
  try {
    const response = await fetch("/api/videos");
    if (!response.ok) throw new Error("Could not load videos.");
    const videos = await response.json();
    if (!videos.length) { grid.innerHTML = '<p class="empty-videos">No videos added yet. Please check back soon.</p>'; return; }
    grid.innerHTML = videos.map(video => {
      const media = getVideoEmbed(video.video_url);
      let player = media.type === "embed"
        ? `<iframe src="${escapeHtml(media.src)}" title="${escapeHtml(video.title)}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`
        : media.type === "file"
          ? `<video controls preload="metadata"><source src="${escapeHtml(media.src)}" type="video/mp4">Your browser does not support this video.</video>`
          : `<a class="button button-primary video-open-link" href="${escapeHtml(media.src)}" target="_blank" rel="noopener noreferrer">Watch video ↗</a>`;
      return `<article class="video-card"><div class="video-player">${player}</div><div class="video-card-copy"><span class="lesson-category">${escapeHtml(video.category)}</span><h3>${escapeHtml(video.title)}</h3><p>${escapeHtml(video.description || "")}</p></div></article>`;
    }).join("");
  } catch { grid.innerHTML = '<p class="error-box">Videos could not be loaded. Refresh the page and try again.</p>'; }
}
loadVideos();
