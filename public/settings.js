renderSidebar("settings");

const PALETTE = ["#e9b308", "#4c9bff", "#ff8038", "#a78bfa", "#22d3ee", "#f472b6", "#34d399"];
let categories = [];
let saveTimer;

async function load() {
  categories = await fetchTagCategories();
  render();
}

function save() {
  const st = document.getElementById("status");
  clearTimeout(saveTimer);
  st.textContent = "speichert…";
  saveTimer = setTimeout(async () => {
    try {
      await fetch("/api/settings/tags", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories }),
      });
      st.textContent = "gespeichert ✓";
    } catch {
      st.textContent = "Fehler beim Speichern";
    }
  }, 400);
}

function chip(c, t, ti) {
  const { bg, fg, bd } = chipColors(c.color || "#e9b308");
  return `<span class="label-chip colored" style="background:${bg};color:${fg};border:1px solid ${bd}">${escapeHtml(t)}<i class="x" data-ci="${c._i}" data-ti="${ti}">✕</i></span>`;
}

function render() {
  const list = document.getElementById("catList");
  if (!categories.length) {
    list.innerHTML = `<div class="empty">Noch keine Kategorien — füge unten eine hinzu.</div>`;
    return;
  }
  list.innerHTML = categories
    .map((c, ci) => {
      c._i = ci;
      return `
    <div class="card cat-card">
      <div class="cat-head">
        <input type="color" class="cat-color" data-ci="${ci}" value="${c.color || "#e9b308"}" />
        <input class="cat-name" data-ci="${ci}" value="${escapeHtml(c.name)}" placeholder="Kategoriename" />
        <span class="cat-del" data-del="${ci}" title="Kategorie löschen">✕</span>
      </div>
      <div class="cat-tags">
        ${c.tags.map((t, ti) => chip(c, t, ti)).join("")}
        <span class="label-add"><input class="tag-input" data-ci="${ci}" placeholder="Tag…" /><i class="plus" data-addtag="${ci}">＋</i></span>
      </div>
    </div>`;
    })
    .join("");
  wire();
}

function wire() {
  document.querySelectorAll(".cat-color").forEach((el) => {
    el.onchange = () => { categories[+el.dataset.ci].color = el.value; render(); save(); };
  });
  document.querySelectorAll(".cat-name").forEach((el) => {
    el.onchange = () => { categories[+el.dataset.ci].name = el.value.trim(); save(); };
  });
  document.querySelectorAll("[data-del]").forEach((el) => {
    el.onclick = () => { categories.splice(+el.dataset.del, 1); render(); save(); };
  });
  document.querySelectorAll(".cat-tags .x").forEach((el) => {
    el.onclick = () => { categories[+el.dataset.ci].tags.splice(+el.dataset.ti, 1); render(); save(); };
  });
  document.querySelectorAll("[data-addtag]").forEach((el) => {
    const ci = +el.dataset.addtag;
    const input = document.querySelector(`.tag-input[data-ci="${ci}"]`);
    const add = () => {
      const v = input.value.trim();
      if (v && !categories[ci].tags.includes(v)) { categories[ci].tags.push(v); render(); save(); }
    };
    el.onclick = add;
    input.onkeydown = (e) => { if (e.key === "Enter") add(); };
  });
}

document.getElementById("addCat").onclick = () => {
  categories.push({ name: "Neue Kategorie", color: PALETTE[categories.length % PALETTE.length], tags: [] });
  render();
  save();
};

load();
